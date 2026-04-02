const _log = console.log.bind(console);
#!/usr/bin/env node
'use strict';

/**
 * 今日头条视频发布脚本
 *
 * 方案：Playwright CDP + SCP 到 Windows
 * 流程：SCP 视频/封面到 Windows → CDP 连接 → 上传视频 → 填写信息 → 发布
 *
 * 用法：
 *   node publish-toutiao-video.cjs \
 *       --title "视频标题" \
 *       --video /path/to/video.mp4 \
 *       [--cover /path/to/cover.jpg] \
 *       [--desc "视频描述"] \
 *       [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://100.97.242.124:19226';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\toutiao-media';
const UPLOAD_URL = 'https://mp.toutiao.com/profile_v4/xigua/upload-video';
const SCREENSHOTS_DIR = '/tmp/toutiao-video-screenshots';

function parseArgs(argv) {
  const args = argv.slice(2);
  const take = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : '';
  };
  const title = (take('--title') || '').trim();
  const video = take('--video');
  const cover = take('--cover');
  const desc = (take('--desc') || '').trim();
  const dryRun = args.includes('--dry-run');

  if (!title) {
    console.error('用法: node publish-toutiao-video.cjs --title "标题" --video /path/to/video.mp4 [--cover /path/to/cover.jpg] [--desc "描述"] [--dry-run]');
    throw new Error('必须提供 --title');
  }
  if (!video || !fs.existsSync(video)) {
    throw new Error(`必须提供有效的 --video 路径: ${video}`);
  }
  if (cover && !fs.existsSync(cover)) {
    throw new Error(`封面文件不存在: ${cover}`);
  }

  return { title, video: path.resolve(video), cover: cover ? path.resolve(cover) : null, desc, dryRun };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeBatchId() {
  const now = new Date();
  return `video-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
}

function toWindowsScpPath(p) {
  return p.replace(/\\/g, '/');
}

function scpToWindows(localFiles, winDir) {
  const winDirScp = toWindowsScpPath(winDir);
  execFileSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    `${WINDOWS_USER}@${WINDOWS_IP}`,
    `powershell -command "New-Item -ItemType Directory -Force -Path '${winDirScp}' | Out-Null; Write-Host ok"`,
  ], { timeout: 20000, stdio: 'pipe' });

  for (const f of localFiles) {
    execFileSync('scp', [
      '-o', 'StrictHostKeyChecking=no',
      f, `${WINDOWS_USER}@${WINDOWS_IP}:${winDirScp}/${path.basename(f)}`,
    ], { timeout: 120000, stdio: 'pipe' });
    _log(`[TT-Video]    已复制: ${path.basename(f)}`);
  }
}

async function screenshot(page, name) {
  ensureDir(SCREENSHOTS_DIR);
  const out = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  _log(`[TT-Video]    截图: ${out}`);
}

async function main() {
  const { title, video, cover, desc, dryRun } = parseArgs(process.argv);

  _log('[TT-Video] ========================================');
  _log('[TT-Video] 今日头条视频发布');
  _log('[TT-Video] ========================================');
  _log(`[TT-Video] 标题: ${title}`);
  _log(`[TT-Video] 视频: ${video}`);
  _log(`[TT-Video] 封面: ${cover || '无'}`);
  _log(`[TT-Video] 描述长度: ${desc.length}`);
  _log(`[TT-Video] 模式: ${dryRun ? 'dry-run' : 'publish'}`);

  if (dryRun) {
    _log('[TT-Video] dry-run 完成，未实际上传');
    return;
  }

  const batchId = makeBatchId();
  const winDir = `${WINDOWS_BASE_DIR}\\${batchId}`;
  const localFiles = [video, cover].filter(Boolean);
  const winVideoPath = `${winDir}\\${path.basename(video)}`;
  const winCoverPath = cover ? `${winDir}\\${path.basename(cover)}` : null;

  _log('[TT-Video] 0. SCP 文件到 Windows...');
  scpToWindows(localFiles, winDir);

  ensureDir(SCREENSHOTS_DIR);

  _log('[TT-Video] 1. 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  page.on('dialog', d => { d.dismiss().catch(() => {}); });

  try {
    _log('[TT-Video] 2. 打开上传页面...');
    await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await screenshot(page, '01-upload-page');

    // 忽略草稿弹窗
    const ignoreBtn = page.getByRole('button', { name: '忽略' });
    if (await ignoreBtn.count() > 0) {
      await ignoreBtn.first().click().catch(() => {});
      await page.waitForTimeout(1500);
    }

    _log('[TT-Video] 3. 上传视频...');
    const cdpSession = await context.newCDPSession(page);
    const { result: videoInputResult } = await cdpSession.send('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"][accept*="video"]\')',
    });
    if (!videoInputResult.objectId) throw new Error('未找到视频 file input');
    const { node: videoNode } = await cdpSession.send('DOM.describeNode', { objectId: videoInputResult.objectId });
    await cdpSession.send('DOM.setFileInputFiles', { backendNodeId: videoNode.backendNodeId, files: [winVideoPath] });
    _log('[TT-Video]    视频已写入 input，等待标题 input 出现...');
    // 等待标题 input 出现（最多5分钟），selector 为 xigua-input 或 placeholder
    await page.waitForSelector('input.xigua-input, input[placeholder*="请输入"]', { timeout: 300000 });
    await page.waitForTimeout(2000);
    _log('[TT-Video]    当前 URL:', page.url());
    await screenshot(page, '02-video-uploading');

    _log('[TT-Video] 4. 填写标题...');
    const titleFilled = await page.evaluate((titleText) => {
      const input = document.querySelector('input.xigua-input') ||
                    document.querySelector('input[placeholder*="请输入 1～30"]') ||
                    document.querySelector('input[placeholder*="请输入"]');
      if (!input) return { success: false };
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, placeholder: input.placeholder, value: input.value };
    }, title);
    _log('[TT-Video]    标题填写:', JSON.stringify(titleFilled));
    await page.waitForTimeout(500);

    if (desc) {
      _log('[TT-Video] 5. 填写描述...');
      const textarea = page.locator('textarea').first();
      if (await textarea.count() > 0) {
        await textarea.fill(desc);
        await page.waitForTimeout(500);
      }
    }

    if (winCoverPath) {
      _log('[TT-Video] 6. 上传封面...');
      // 先尝试点击"上传封面"按钮
      const coverBtns = page.locator('button, div[class*="upload"]').filter({ hasText: /上传封面|本地上传|选择封面/ });
      if (await coverBtns.count() > 0) {
        await coverBtns.first().click().catch(() => {});
        await page.waitForTimeout(1000);
      }
      const { result: coverInputResult } = await cdpSession.send('Runtime.evaluate', {
        expression: 'document.querySelector(\'input[type="file"][accept*="image"]\')',
      });
      if (coverInputResult.objectId) {
        const { node: coverNode } = await cdpSession.send('DOM.describeNode', { objectId: coverInputResult.objectId });
        await cdpSession.send('DOM.setFileInputFiles', { backendNodeId: coverNode.backendNodeId, files: [winCoverPath] });
        await page.waitForTimeout(5000);
        // 完成裁剪
        const cropBtn = page.locator('button').filter({ hasText: /完成裁剪|确定/ }).first();
        if (await cropBtn.count() > 0) {
          await cropBtn.click().catch(() => {});
          await page.waitForTimeout(2000);
        }
        await screenshot(page, '03-cover-uploaded');
      } else {
        console.warn('[TT-Video]    未找到封面 input，跳过封面上传');
      }
    }

    await screenshot(page, '04-filled');

    _log('[TT-Video] 7. 点击发布...');
    const publishBtn = page.locator('button').filter({ hasText: /^发布$/ }).first();
    await publishBtn.waitFor({ state: 'visible', timeout: 30000 });
    await publishBtn.click();
    await page.waitForTimeout(8000);
    await screenshot(page, '05-published');

    const url = page.url();
    _log('[TT-Video] 发布完成');
    _log(`[TT-Video] 当前页面: ${url}`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(`[TT-Video] 发布失败: ${err.message}`);
  process.exit(1);
});
