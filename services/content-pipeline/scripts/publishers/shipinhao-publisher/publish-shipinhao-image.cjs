#!/usr/bin/env node
const _log = console.log.bind(console);
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://localhost:19228';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WIN_BASE_DIR = 'C:\\Users\\xuxia\\shipinhao-media';
const CREATE_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate';
const SHOTS_DIR = '/tmp/shipinhao-screenshots';
const MAX_IMAGES = 18;
const MAX_TITLE = 22;
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

function findImages(dir) {
  const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  return fs.readdirSync(dir)
    .filter(file => exts.some(ext => file.toLowerCase().endsWith(ext)))
    .sort()
    .map(file => path.join(dir, file))
    .slice(0, MAX_IMAGES);
}

function readContent(dir) {
  const file = path.join(dir, 'content.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
}

function deriveTitle(text) {
  if (!text) return '';
  const firstLine = text.split(/\n+/).find(Boolean) || '';
  return firstLine.split(/[。！？!?]/)[0].trim().slice(0, MAX_TITLE);
}

function toWindowsScpPath(p) {
  return p.replace(/\\/g, '/');
}

function scpToWindows(localImages, winDir) {
  _log('[SPH] SCP 图片到 Windows...');
  const winDirForScp = toWindowsScpPath(winDir);

  execFileSync(
    'ssh',
    [
      '-o',
      'StrictHostKeyChecking=no',
      `${WINDOWS_USER}@${WINDOWS_IP}`,
      `powershell -command "New-Item -ItemType Directory -Force -Path '${winDirForScp}' | Out-Null; Write-Host ok"`,
    ],
    { timeout: 20000, stdio: 'pipe' }
  );

  for (const image of localImages) {
    execFileSync(
      'scp',
      [
        '-o',
        'StrictHostKeyChecking=no',
        image,
        `${WINDOWS_USER}@${WINDOWS_IP}:${winDirForScp}/${path.basename(image)}`,
      ],
      { timeout: 60000, stdio: 'pipe' }
    );
  }

  _log(`[SPH]    ${localImages.length} 张图片已传到 Windows`);
}

async function screenshot(page, name) {
  const target = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  _log(`[SPH]    截图: ${target}`);
}

async function waitForReady(page) {
  try {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
    _log('[SPH]    导航返回 ERR_ABORTED，继续等待当前页面就绪');
  }
  await page.waitForTimeout(12000);
  await page.locator('text=页面初始化中').waitFor({ state: 'hidden', timeout: INIT_WAIT_MS }).catch(() => {});
  await page.locator(SELECTORS.uploadButton).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator(SELECTORS.titleInput).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3000);
}

async function deepResolveFileInput(page, cdpSession) {
  const expression = `(() => {
    const walk = root => {
      if (!root) return null;
      const direct = root.querySelector?.('${SELECTORS.fileInput.replace(/'/g, "\\'")}');
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

async function getInputFileCount(page) {
  return page.locator(SELECTORS.fileInput).first().evaluate(el => el.files?.length || 0);
}

async function uploadImages(page, context, localImages, winImages) {
  _log('[SPH] 3. 上传图片...');
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.locator(SELECTORS.uploadButton).first().click({ timeout: 10000 });
  const fileChooser = await chooserPromise;
  _log('[SPH]    已捕获 filechooser');

  let uploadedBy = 'cdp';

  const cdpSession = await context.newCDPSession(page);
  const backendNodeId = await deepResolveFileInput(page, cdpSession);
  await cdpSession.send('DOM.setFileInputFiles', {
    backendNodeId,
    files: winImages,
  });
  await page.waitForTimeout(3000);
  const fileCount = await getInputFileCount(page);
  _log(`[SPH]    文件已设置，input.files=${fileCount}`);

  await page.waitForTimeout(8000);
  _log(`[SPH]    上传方式: ${uploadedBy}`);
}

async function fillTitle(page, title) {
  if (!title) return;
  _log('[SPH] 4. 填写标题...');
  const input = page.locator(SELECTORS.titleInput).first();
  await input.click();
  await input.fill(title);
}

async function fillDescription(page, content) {
  if (!content) return;
  _log('[SPH] 5. 填写描述...');
  const editor = page.locator(SELECTORS.descEditor).first();
  await editor.click();
  await editor.fill(content);
}

async function verifyDraft(page, expectedTitle, expectedContent) {
  const titleValue = await page.locator(SELECTORS.titleInput).first().inputValue();
  const descText = await page.locator(SELECTORS.descEditor).first().innerText();
  const imageVisible = await page.locator('.post-edit-wrap').evaluate(el => {
    const text = el.innerText || '';
    return /选择图片/.test(text) || /所选图片/.test(text) || !!el.querySelector('canvas, img');
  });
  const publishText = await page.locator(SELECTORS.publishButton).first().innerText();

  if (expectedTitle && titleValue !== expectedTitle) {
    throw new Error(`标题校验失败: ${titleValue}`);
  }
  if (expectedContent && !descText.includes(expectedContent)) {
    throw new Error('描述校验失败');
  }
  if (!imageVisible) {
    throw new Error('未检测到图片预览');
  }

  _log(`[SPH]    校验通过: 图片已显示, 标题="${titleValue}", 发表按钮="${publishText}"`);
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

  _log('[SPH] ========================================');
  _log('[SPH] 视频号图文发布 (Playwright + CDP)');
  _log('[SPH] ========================================');
  _log(`[SPH] 图片: ${localImages.length} 张`);
  _log(`[SPH] 标题: ${title || '(空)'}`);
  _log(`[SPH] 模式: ${isDryRun ? 'dry-run' : 'publish'}`);

  ensureDir(SHOTS_DIR);
  scpToWindows(localImages, winDir);

  _log('[SPH] 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0];
  const page = await context.newPage();
  _log('[SPH] CDP 已连接，已创建新标签页用于发布');

  page.on('dialog', dialog => {
    _log(`[SPH]    关闭对话框: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });

  try {
    _log('[SPH] 1. 导航并等待页面初始化完成...');
    await waitForReady(page);
    await screenshot(page, '01-ready');

    await uploadImages(page, context, localImages, winImages);
    await screenshot(page, '02-uploaded');

    await fillTitle(page, title);
    await fillDescription(page, contentText);
    await page.locator(SELECTORS.publishButton).first().waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(3000);
    await screenshot(page, '03-filled');
    await verifyDraft(page, title, contentText);

    if (isDryRun) {
      _log('[SPH] dry-run 完成，未点击发表');
      return;
    }

    _log('[SPH] 6. 点击发表...');
    await page.locator(SELECTORS.publishButton).first().click({ timeout: 10000 });
    await page.waitForTimeout(5000);
    await screenshot(page, '04-published');
    _log('[SPH] 发布完成');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('[SPH] 发布失败:', error.message);
  process.exit(1);
});
