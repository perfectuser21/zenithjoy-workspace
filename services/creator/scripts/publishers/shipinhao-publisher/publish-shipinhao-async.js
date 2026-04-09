'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://localhost:19228';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WIN_BASE_DIR = 'C:\\Users\\xuxia\\shipinhao-media';
const CREATE_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate';
const SHOTS_DIR = '/tmp/shipinhao-screenshots';

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

function findImages(dir) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  return fs.readdirSync(dir)
    .filter(file => exts.some(ext => file.toLowerCase().endsWith(ext)))
    .sort()
    .map(file => path.join(dir, file))
    .slice(0, 18);
}

function readContent(dir) {
  const file = path.join(dir, 'content.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

function deriveTitle(text) {
  if (!text) return '';
  const firstLine = text.split(/\n+/).find(Boolean) || '';
  return firstLine.split(/[。！？!?]/)[0].trim().slice(0, 22);
}

function runCommand(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Command timed out: ${cmd} ${args[0]}`));
    }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Exit ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

async function scpToWindows(localImages, winDir) {
  console.log('[SPH] SCP 图片到 Windows...');
  const winDirForScp = winDir.replace(/\\/g, '/');
  
  await runCommand('ssh', ['-o', 'StrictHostKeyChecking=no', `${WINDOWS_USER}@${WINDOWS_IP}`,
    `powershell -command "New-Item -ItemType Directory -Force -Path '${winDirForScp}' | Out-Null; Write-Host ok"`], 30000);
  
  for (const image of localImages) {
    const dest = `${WINDOWS_USER}@${WINDOWS_IP}:${winDirForScp}/${path.basename(image)}`;
    await runCommand('scp', ['-o', 'StrictHostKeyChecking=no', image, dest], 120000);
    console.log(`[SPH]    上传: ${path.basename(image)}`);
  }
  console.log(`[SPH]    ${localImages.length} 张图片已传到 Windows`);
}

async function screenshot(page, name) {
  const target = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  console.log(`[SPH]    截图: ${target}`);
}

async function waitForReady(page) {
  try {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
  }
  await page.waitForTimeout(12000);
  await page.locator('text=页面初始化中').waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
  await page.locator(SELECTORS.uploadButton).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(SELECTORS.titleInput).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3000);
}

async function deepResolveFileInput(page, cdpSession) {
  const expression = `(() => {
    const walk = root => {
      if (!root) return null;
      const direct = root.querySelector?.('.post-edit-wrap .ant-upload input[type="file"]');
      if (direct) return direct;
      const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
      for (const node of nodes) {
        if (node.shadowRoot) {
          const found = walk(node.shadowRoot);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(document);
  })()`;
  const { result } = await cdpSession.send('Runtime.evaluate', { expression });
  if (!result.objectId) throw new Error('未获取到上传 input 的 objectId');
  const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
  return node.backendNodeId;
}

async function uploadImages(page, context, localImages, winImages) {
  console.log('[SPH] 3. 上传图片...');
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.locator(SELECTORS.uploadButton).first().click({ timeout: 10000 });
  const fileChooser = await chooserPromise;

  let uploadedBy = 'cdp';
  try {
    const cdpSession = await context.newCDPSession(page);
    const backendNodeId = await deepResolveFileInput(page, cdpSession);
    await cdpSession.send('DOM.setFileInputFiles', { backendNodeId, files: winImages });
    await page.waitForTimeout(1500);
    const fileCount = await page.locator(SELECTORS.fileInput).first().evaluate(el => el.files?.length || 0);
    if (fileCount !== winImages.length) throw new Error(`CDP set ${fileCount} files`);
  } catch (error) {
    uploadedBy = 'playwright-fallback';
    console.log(`[SPH]    CDP fallback: ${error.message}`);
    await fileChooser.setFiles(localImages);
    await page.waitForTimeout(1500);
  }

  await page.waitForTimeout(8000);
  console.log(`[SPH]    上传方式: ${uploadedBy}`);
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const contentIndex = args.indexOf('--content');
  const contentDir = contentIndex !== -1 ? args[contentIndex + 1] : null;

  if (!contentDir || !fs.existsSync(contentDir)) {
    console.error('[SPH] 必须提供 --content <目录>');
    process.exit(1);
  }

  const localImages = findImages(contentDir);
  if (!localImages.length) {
    console.error('[SPH] 没有找到图片');
    process.exit(1);
  }

  const contentText = readContent(contentDir);
  const title = deriveTitle(contentText);
  const dateDir = path.basename(path.dirname(contentDir));
  const contentDirName = path.basename(contentDir);
  const winDir = `${WIN_BASE_DIR}\\${dateDir}\\${contentDirName}`;
  const winImages = localImages.map(image => `${winDir}\\${path.basename(image)}`);

  console.log('[SPH] ========================================');
  console.log('[SPH] 视频号图文发布 (Playwright + CDP)');
  console.log('[SPH] ========================================');
  console.log(`[SPH] 图片: ${localImages.length} 张`);
  console.log(`[SPH] 标题: ${title || '(空)'}`);
  console.log(`[SPH] 模式: ${isDryRun ? 'dry-run' : 'publish'}`);

  ensureDir(SHOTS_DIR);
  await scpToWindows(localImages, winDir);

  console.log('[SPH] 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0];
  const page = await context.newPage();
  console.log('[SPH] CDP 已连接');

  page.on('dialog', dialog => { dialog.dismiss().catch(() => {}); });

  try {
    console.log('[SPH] 1. 导航...');
    await waitForReady(page);
    await screenshot(page, '01-ready');

    await uploadImages(page, context, localImages, winImages);
    await screenshot(page, '02-uploaded');

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
    console.log('[SPH] 发布完成');
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('[SPH] 发布失败:', e.message);
  process.exit(1);
});
