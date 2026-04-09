#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 快手视频发布脚本
 *
 * 方案：Playwright connectOverCDP
 *   - 端口：19223（专用快手 Chrome 实例）
 *   - 上传：直接通过 file chooser / setFiles 上传本机文件
 *   - 标题：写入作品描述
 *
 * 用法：
 *   node publish-kuaishou-video.cjs \
 *     --title "标题文案" \
 *     --video /path/to/video.mp4 \
 *     [--cover /path/to/cover.jpg]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const WINDOWS_IP_KS = '100.97.242.124';
const WINDOWS_USER_KS = 'xuxia';
const WINDOWS_BASE_DIR_KS = 'C:\\Users\\xuxia\\kuaishou-media';

function scpToWindows(localFile, windowsDir) {
  const fname = require('path').basename(localFile);
  const winDirFwd = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER_KS}@${WINDOWS_IP_KS} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirFwd}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFile}" "${WINDOWS_USER_KS}@${WINDOWS_IP_KS}:${winDirFwd}/${fname}"`,
    { timeout: 300000, stdio: 'pipe' }
  );
  return require('path').join(windowsDir, fname);
}

async function setFileInputViaCDP(context, page, selector, windowsPath) {
  const cdpSession = await context.newCDPSession(page);
  const { result } = await cdpSession.send('Runtime.evaluate', { expression: `document.querySelector('${selector}')` });
  if (!result.objectId) throw new Error(`未找到 file input: ${selector}`);
  const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
  await cdpSession.send('DOM.setFileInputFiles', { backendNodeId: node.backendNodeId, files: [windowsPath] });
  await cdpSession.detach();
}

const CDP_URL = 'http://localhost:19223';
const PUBLISH_URL = 'https://cp.kuaishou.com/article/publish/video';
const MANAGE_URL = 'https://cp.kuaishou.com/article/manage/video?status=2&from=publish';
const SCREENSHOTS_DIR = '/tmp/kuaishou-publish-screenshots';
const SUCCESS_SCREENSHOT = '/tmp/kuaishou-video-success.png';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isLoginUrl(url) {
  return url.includes('passport.kuaishou.com') || url.includes('/account/login');
}

async function dismissDraftModal(page) {
  for (const text of ['放弃草稿', '放弃']) {
    const locator = page.getByText(text, { exact: true });
    if (await locator.count()) {
      await locator.first().click().catch(() => {});
      await sleep(1000);
      return text;
    }
  }
  return null;
}

async function takeScreenshot(page, filePath, fullPage = true) {
  await page.screenshot({ path: filePath, fullPage }).catch(() => {});
}

async function waitForEditor(page, timeoutMs = 120000) {
  await page.locator('#work-description-edit').waitFor({ state: 'visible', timeout: timeoutMs });
  await page.getByText('封面设置', { exact: true }).first().waitFor({ state: 'visible', timeout: timeoutMs });
}

async function uploadVideo(page, context, videoPath, windowsVideoPath) {
  // 尝试直接用 DOM.setFileInputFiles（跨机器 CDP 必须用 Windows 路径）
  await page.getByRole('button', { name: '上传视频' }).click().catch(() => {});
  await page.waitForTimeout(1000);
  await setFileInputViaCDP(context, page, 'input[type="file"]', windowsVideoPath);
}

async function fillTitle(page, title) {
  const editor = page.locator('#work-description-edit');
  await editor.click();
  await editor.evaluate((node, value) => {
    node.focus();
    node.textContent = '';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    node.textContent = value;
    node.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  }, title);
  await sleep(800);
}

async function uploadCover(page, context, coverPath, windowsCoverPath) {
  await setFileInputViaCDP(context, page, 'input[type="file"][accept*="image"]', windowsCoverPath);
  await sleep(2500);
}

async function clickPublish(page) {
  const publish = page.getByText('发布', { exact: true }).last();
  await publish.scrollIntoViewIfNeeded();
  await publish.click({ timeout: 10000 });
}

async function waitForPublishSuccess(page, title, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (page.url().includes('/article/manage/video')) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes(title)) {
        return {
          url: page.url(),
          text: bodyText,
        };
      }
    }

    const confirm = page.getByText('确定', { exact: true });
    if (await confirm.count()) {
      await confirm.first().click().catch(() => {});
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    if (/失败|错误|异常/.test(bodyText)) {
      throw new Error(`发布失败: ${bodyText.slice(0, 200)}`);
    }

    await sleep(2000);
  }

  throw new Error('发布后未在作品管理页看到新视频');
}

async function main(opts) {
  ensureDir(SCREENSHOTS_DIR);

  _log('\n[KS] ========================================');
  _log('[KS] 快手视频发布');
  _log('[KS] ========================================\n');
  _log(`[KS] 标题: ${opts.title}`);
  _log(`[KS] 视频: ${opts.video}`);
  if (opts.cover) _log(`[KS] 封面: ${opts.cover}`);

  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages().find(p => p.url().includes('cp.kuaishou.com')) || await context.newPage();
  // context is used for CDP sessions in file upload

  try {
    _log('\n[KS] 1. 打开发布页...');
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded' });
    await sleep(5000);
    const draftAction = await dismissDraftModal(page);
    if (draftAction) _log(`[KS]    草稿处理: ${draftAction}`);
    await takeScreenshot(page, path.join(SCREENSHOTS_DIR, 'ks-video-01-publish-page.png'));

    if (isLoginUrl(page.url())) {
      throw new Error('快手未登录，请先在专用 Chrome 中登录创作者中心');
    }

    _log('\n[KS] 2. SCP 视频到 Windows...');
    const winVideoDir = `${WINDOWS_BASE_DIR_KS}\\${Date.now()}`;
    const winVideoPath = scpToWindows(opts.video, winVideoDir);
    _log(`[KS]    Windows 视频: ${winVideoPath}`);
    
    _log('\n[KS] 2. 上传视频...');
    await uploadVideo(page, context, opts.video, winVideoPath);
    await waitForEditor(page);
    await takeScreenshot(page, path.join(SCREENSHOTS_DIR, 'ks-video-02-editor.png'));

    _log('\n[KS] 3. 填写作品描述...');
    await fillTitle(page, opts.title);
    await takeScreenshot(page, path.join(SCREENSHOTS_DIR, 'ks-video-03-title.png'));

    if (opts.cover) {
      _log('\n[KS] 4. 上传封面...');
      const winCoverPath = scpToWindows(opts.cover, winVideoDir);
    await uploadCover(page, context, opts.cover, winCoverPath);
      await takeScreenshot(page, path.join(SCREENSHOTS_DIR, 'ks-video-04-cover.png'));
    }

    _log('\n[KS] 5. 点击发布...');
    await clickPublish(page);

    _log('\n[KS] 6. 等待平台确认...');
    const final = await waitForPublishSuccess(page, opts.title);
    await takeScreenshot(page, path.join(SCREENSHOTS_DIR, 'ks-video-05-success.png'));
    await takeScreenshot(page, SUCCESS_SCREENSHOT);

    _log('\n[KS] ========================================');
    _log(`[KS] URL: ${final.url}`);
    _log(`[KS] 标题确认: ${final.text.includes(opts.title) ? '已看到新作品' : '未确认'}`);
    _log(`[KS] 成功截图: ${SUCCESS_SCREENSHOT}`);
    _log('[KS] ========================================\n');
  } finally {
    await browser.close().catch(() => {});
  }
}

function parseArgs(argv) {
  const get = flag => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : null;
  };

  const title = get('--title');
  const video = get('--video');
  const cover = get('--cover');

  if (!title || !video) {
    console.error('[KS] 用法: node publish-kuaishou-video.cjs --title "标题" --video /path/to/video.mp4 [--cover /path/to/cover.jpg]');
    process.exit(1);
  }
  if (!fs.existsSync(video)) {
    console.error(`[KS] 视频文件不存在: ${video}`);
    process.exit(1);
  }
  if (cover && !fs.existsSync(cover)) {
    console.error(`[KS] 封面文件不存在: ${cover}`);
    process.exit(1);
  }

  return {
    title: title.trim(),
    video: path.resolve(video),
    cover: cover ? path.resolve(cover) : null,
  };
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  try {
    await main(opts);
  } catch (err) {
    console.error(`\n[KS] 发布失败: ${err.message}`);
    process.exit(1);
  }
})();
