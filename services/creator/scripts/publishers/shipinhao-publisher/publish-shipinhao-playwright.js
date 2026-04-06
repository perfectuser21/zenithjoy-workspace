'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CDP_URL = 'http://100.97.242.124:19228';
const SHOTS_DIR = '/tmp/shipinhao-screenshots';
const CREATE_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate';
const INIT_WAIT_MS = 120000;

const SELECTORS = {
  uploadButton: '.post-edit-wrap .ant-upload .ant-upload-btn:visible',
  fileInput: '.post-edit-wrap .ant-upload input[type="file"]',
  titleInput: 'input[placeholder="填写标题, 22个字符内"]:visible',
  descEditor: '.input-editor[data-placeholder="添加描述, 1000个字符内"]:visible',
  publishButton: 'button.weui-desktop-btn_primary:visible',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function screenshot(page, name) {
  ensureDir(SHOTS_DIR);
  const target = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[SPH] 截图: ${target}`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const localDir = args[args.indexOf('--local-dir') + 1];
  const winDir = args[args.indexOf('--win-dir') + 1];
  const title = args[args.indexOf('--title') + 1];
  const contentFile = args[args.indexOf('--content-file') + 1];

  const contentText = contentFile && fs.existsSync(contentFile) 
    ? fs.readFileSync(contentFile, 'utf8').trim() : '';

  // Get local images for fallback
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const localImages = localDir ? fs.readdirSync(localDir)
    .filter(f => exts.some(e => f.toLowerCase().endsWith(e)))
    .sort()
    .map(f => path.join(localDir, f))
    .slice(0, 18) : [];

  // Windows image paths (already uploaded)
  const winImages = localImages.map(img => `${winDir}\\${path.basename(img)}`);

  console.log(`[SPH] 标题: ${title}`);
  console.log(`[SPH] 图片数: ${localImages.length} 张 (Windows pre-uploaded)`);
  console.log(`[SPH] 模式: ${isDryRun ? 'dry-run' : 'publish'}`);

  console.log('[SPH] 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0];
  const page = await context.newPage();
  console.log('[SPH] CDP 已连接');

  page.on('dialog', dialog => { dialog.dismiss().catch(() => {}); });

  try {
    console.log('[SPH] 1. 导航到创建页...');
    try {
      await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
    }
    await page.waitForTimeout(12000);
    await page.locator('text=页面初始化中').waitFor({ state: 'hidden', timeout: INIT_WAIT_MS }).catch(() => {});
    await page.locator(SELECTORS.uploadButton).first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator(SELECTORS.titleInput).first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(3000);
    await screenshot(page, '01-ready');
    console.log('[SPH] 2. 页面就绪');

    console.log('[SPH] 3. 上传图片...');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.locator(SELECTORS.uploadButton).first().click({ timeout: 10000 });
    const fileChooser = await chooserPromise;

    let uploadedBy = 'cdp';
    if (winImages.length > 0) {
      try {
        const cdpSession = await context.newCDPSession(page);
        // Deep resolve file input
        const expression = `(() => {
          const walk = root => {
            if (!root) return null;
            const direct = root.querySelector?.('.post-edit-wrap .ant-upload input[type="file"]');
            if (direct) return direct;
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
            for (const node of nodes) {
              if (node.shadowRoot) { const f = walk(node.shadowRoot); if (f) return f; }
            }
            return null;
          };
          return walk(document);
        })()`;
        const { result } = await cdpSession.send('Runtime.evaluate', { expression });
        if (!result.objectId) throw new Error('No file input objectId');
        const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
        await cdpSession.send('DOM.setFileInputFiles', { backendNodeId: node.backendNodeId, files: winImages });
        await page.waitForTimeout(1500);
        const fileCount = await page.locator(SELECTORS.fileInput).first().evaluate(el => el.files?.length || 0);
        if (fileCount !== winImages.length) throw new Error(`CDP: ${fileCount}/${winImages.length} files`);
        console.log('[SPH]    CDP 上传成功');
      } catch (error) {
        uploadedBy = 'playwright-fallback';
        console.log(`[SPH]    CDP 失败，本地 fallback: ${error.message}`);
        await fileChooser.setFiles(localImages);
        await page.waitForTimeout(1500);
      }
    } else {
      uploadedBy = 'playwright-fallback';
      await fileChooser.setFiles(localImages);
    }

    await page.waitForTimeout(8000);
    await screenshot(page, '02-uploaded');
    console.log(`[SPH]    上传方式: ${uploadedBy}`);

    if (title) {
      console.log('[SPH] 4. 填写标题...');
      const input = page.locator(SELECTORS.titleInput).first();
      await input.click();
      await input.fill(title);
    }

    if (contentText) {
      console.log('[SPH] 5. 填写描述...');
      const editor = page.locator(SELECTORS.descEditor).first();
      await editor.click();
      await editor.fill(contentText);
    }

    await page.locator(SELECTORS.publishButton).first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(3000);
    await screenshot(page, '03-filled');

    if (isDryRun) {
      console.log('[SPH] dry-run 完成，未点击发表');
      return;
    }

    console.log('[SPH] 6. 点击发表...');
    await page.locator(SELECTORS.publishButton).first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);
    await screenshot(page, '04-published');
    console.log('[SPH] ✅ 发布完成!');
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('[SPH] 发布失败:', e.message);
  process.exit(1);
});
