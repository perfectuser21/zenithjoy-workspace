const _log = console.log.bind(console);
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://100.97.242.124:19228';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WIN_BASE_DIR = 'C:\\Users\\xuxia\\shipinhao-media';
const CREATE_URL = 'https://channels.weixin.qq.com/platform/post/create';
const SHOTS_DIR = '/tmp/shipinhao-video-screenshots';
const SUCCESS_SHOT = '/tmp/shipinhao-video-fix-success.png';
const INIT_WAIT_MS = 120000;
const UPLOAD_WAIT_MS = 15 * 60 * 1000;

// CSS selectors (in the iframe's document)
const SEL_FILE_INPUT = 'input[type="file"][accept*="video"]';
const SEL_TITLE_INPUT = 'input[placeholder="概括视频主要内容，字数建议6-16个字符"]';
const SEL_DESC_EDITOR = '.input-editor[data-placeholder="添加描述"]';

// ── page.evaluate helpers that access iframe via contentDocument ──────────────

/** 在主页面 evaluate 中找到编辑器 iframe 的 contentDocument */
function FIND_DOC_JS() {
  return `
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    iframe ? iframe.contentDocument : null
  `;
}

async function iframeExists(page) {
  return page.evaluate(() => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe || !iframe.contentDocument) return false;
    const doc = iframe.contentDocument;
    return !!(doc.querySelector('input[type="file"]') ||
              doc.querySelector('button') ||
              doc.body?.innerText?.includes('发表'));
  }).catch(() => false);
}

async function waitForIframe(page, timeout = INIT_WAIT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await iframeExists(page);
    if (found) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('未找到视频号编辑器 iframe');
}

async function evalInIframe(page, fn, arg) {
  // fn is a string of JS code that runs with `doc` = iframe contentDocument, `arg` = argument
  return page.evaluate(([fnBody, argVal]) => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe || !iframe.contentDocument) return null;
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    // eslint-disable-next-line no-new-func
    return (new Function('doc', 'win', 'arg', fnBody))(doc, win, argVal);
  }, [fn, arg !== undefined ? arg : null]);
}

async function waitForInIframe(page, fn, arg, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await evalInIframe(page, fn, arg).catch(() => null);
    if (result) return result;
    await page.waitForTimeout(500);
  }
  throw new Error(`waitForInIframe 超时`);
}

// ── utility ───────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const take = flag => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : '';
  };

  if (args.includes('--help') || args.includes('-h')) {
    _log('用法: node publish-shipinhao-video.cjs --title "标题" --video /path/to/video.mp4 [--desc "描述"] [--dry-run]');
    process.exit(0);
  }

  const title = take('--title').trim();
  const video = take('--video');
  const desc = take('--desc').trim();
  const isDryRun = args.includes('--dry-run');

  if (!title) { console.error('[SPH-VIDEO] 必须提供 --title'); process.exit(1); }
  if (!video || !fs.existsSync(video)) { console.error('[SPH-VIDEO] 必须提供有效的 --video'); process.exit(1); }

  return { title, desc, isDryRun, video: path.resolve(video) };
}

function formatDateDir(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizePathSegment(input) {
  return (input || '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 80) || 'video';
}

function buildWindowsTarget(localVideo) {
  const dateDir = formatDateDir(new Date());
  const baseName = sanitizePathSegment(path.basename(localVideo, path.extname(localVideo)));
  const uniqueDir = `${baseName}-${Date.now()}`;
  const winDir = `${WIN_BASE_DIR}\\${dateDir}\\${uniqueDir}`;
  const winVideo = `${winDir}\\${path.basename(localVideo)}`;
  return { winDir, winVideo };
}

function scpToWindows(localVideo, winDir) {
  _log('[SPH-VIDEO] SCP 视频到 Windows...');
  const winDirForScp = winDir.replace(/\\/g, '/');

  execFileSync('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    `${WINDOWS_USER}@${WINDOWS_IP}`,
    `powershell -command "New-Item -ItemType Directory -Force -Path '${winDirForScp}' | Out-Null; Write-Host ok"`,
  ], { timeout: 20000, stdio: 'pipe' });

  execFileSync('scp', [
    '-o', 'StrictHostKeyChecking=no',
    localVideo,
    `${WINDOWS_USER}@${WINDOWS_IP}:${winDirForScp}/${path.basename(localVideo)}`,
  ], { timeout: 600000, stdio: 'pipe' });

  _log(`[SPH-VIDEO]    已传到 Windows: ${winDir}`);
}

async function screenshot(page, name) {
  ensureDir(SHOTS_DIR);
  const target = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  _log(`[SPH-VIDEO]    截图: ${target}`);
}

async function screenshotTo(page, target) {
  ensureDir(path.dirname(target));
  await page.screenshot({ path: target, fullPage: true });
  _log(`[SPH-VIDEO]    截图: ${target}`);
}

// ── page-level helpers ────────────────────────────────────────────────────────

async function dismissCommonDialogs(page) {
  const buttonTexts = ['我知道了', '知道了', '取消', '稍后再说'];
  for (const text of buttonTexts) {
    const locator = page.locator(`button:has-text("${text}")`);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const button = locator.nth(i);
      const buttonText = await button.innerText().catch(() => '');
      if (buttonText.trim() === '发表') continue;
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }
}

async function openCreatePage(context) {
  const existingPage = context.pages().find(p => (
    !p.isClosed() &&
    /https:\/\/channels\.weixin\.qq\.com\/platform\/post\/(create|list)/.test(p.url()) &&
    !/login\.html/.test(p.url())
  ));

  if (existingPage) {
    _log('[SPH-VIDEO] 复用现有视频号标签并刷新到创建页');
    await existingPage.bringToFront().catch(() => {});
    try {
      await existingPage.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (error) {
      if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
    }
    return { page: existingPage, createdPage: false };
  }

  const page = await context.newPage();
  _log('[SPH-VIDEO] CDP 已连接，已创建新标签页用于发布');
  try {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (error) {
    if (!String(error.message).includes('net::ERR_ABORTED')) throw error;
  }
  return { page, createdPage: true };
}

// ── core operations (all via page.evaluate + contentDocument) ─────────────────

async function waitForReady(page) {
  await page.waitForTimeout(8000);
  await dismissCommonDialogs(page);
  _log('[SPH-VIDEO] 等待编辑器 iframe 加载...');
  await waitForIframe(page);

  // 诊断
  const state = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return { error: 'no iframe doc' };
    const doc = iframe.contentDocument;
    return {
      url: iframe.src,
      hasFileInput: !!doc.querySelector('input[type="file"]'),
      hasTitleInput: !!doc.querySelector('input[placeholder*="概括视频"]'),
      hasPublishBtn: !!Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === '发表'),
      bodyText: (doc.body?.innerText || '').slice(0, 100),
    };
  }).catch(e => ({ error: e.message }));
  _log('[SPH-VIDEO]    iframe 状态:', JSON.stringify(state));

  // 等待 fileInput + 发表 button via iframe contentDocument
  await waitForInIframe(page,
    `return !!doc.querySelector('input[type="file"]')`,
    null, 30000);
  await waitForInIframe(page,
    `return !!(Array.from(doc.querySelectorAll('button')).find(b => b.textContent.trim() === '发表'))`,
    null, 30000);

  await page.waitForTimeout(2000);
  _log('[SPH-VIDEO]    编辑器就绪');
}

async function deepResolveFileInput(page, context) {
  // CDP session on main page, find file input through iframe contentDocument
  const cdpSession = await context.newCDPSession(page);
  const expression = `(() => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return null;
    return iframe.contentDocument.querySelector('input[type="file"][accept*="video"]') ||
           iframe.contentDocument.querySelector('input[type="file"]');
  })()`;
  const { result } = await cdpSession.send('Runtime.evaluate', { expression });
  if (!result.objectId) throw new Error('未获取到上传 input 的 objectId');
  const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
  return { cdpSession, backendNodeId: node.backendNodeId };
}

async function uploadVideo(page, context, localVideo, windowsTarget) {
  _log('[SPH-VIDEO] 上传视频 (SCP + CDP)...');
  const { winDir, winVideo } = windowsTarget;
  scpToWindows(localVideo, winDir);

  const { cdpSession, backendNodeId } = await deepResolveFileInput(page, context);
  await cdpSession.send('DOM.setFileInputFiles', { backendNodeId, files: [winVideo] });
  await page.waitForTimeout(2000);
  _log('[SPH-VIDEO]    文件已注入到 input');
}

async function fillTitle(page, title) {
  _log('[SPH-VIDEO] 填写标题...');
  // Wait for title input
  await waitForInIframe(page,
    `return !!doc.querySelector('input[placeholder*="概括视频"]')`,
    null, 30000);

  const result = await page.evaluate((titleText) => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return { success: false, reason: 'no doc' };
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const input = doc.querySelector('input[placeholder*="概括视频"]');
    if (!input) return { success: false, reason: 'no input' };
    const nativeSetter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, titleText);
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    input.dispatchEvent(new win.Event('change', { bubbles: true }));
    return { success: true, value: input.value };
  }, title);
  _log(`[SPH-VIDEO]    标题填写: ${JSON.stringify(result)}`);
}

async function fillDescription(page, desc) {
  if (!desc) return;
  _log('[SPH-VIDEO] 填写描述...');
  await page.evaluate((descText) => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return;
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const editor = doc.querySelector('.input-editor[data-placeholder="添加描述"]');
    if (!editor) return;
    editor.focus();
    editor.innerText = descText;
    editor.dispatchEvent(new win.Event('input', { bubbles: true }));
  }, desc);
  _log('[SPH-VIDEO]    描述已填写');
}

async function waitForUploadComplete(page) {
  _log('[SPH-VIDEO] 等待上传完成...');
  const deadline = Date.now() + UPLOAD_WAIT_MS;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[name="content"]') ||
        Array.from(document.querySelectorAll('iframe')).find(f =>
          (f.src || '').includes('micro/content/post'));
      if (!iframe?.contentDocument) return false;
      const doc = iframe.contentDocument;
      const publishButton = Array.from(doc.querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === '发表');
      if (!publishButton) return false;
      const cls = publishButton.className || '';
      const bodyText = doc.body?.innerText || '';
      const previewReady = /删除|编辑|封面预览|个人主页和分享卡片/.test(bodyText) ||
        !!(doc.querySelector('video, canvas, .cover-wrap, .post-cover-selector, .post-create-cover'));
      return !publishButton.disabled && !cls.includes('disabled') && previewReady;
    }).catch(() => false);

    if (ready) {
      await page.waitForTimeout(3000);
      _log('[SPH-VIDEO]    上传完成');
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('等待上传完成超时');
}

async function verifyDraft(page, expectedTitle, expectedDesc) {
  const info = await page.evaluate(([expTitle, expDesc]) => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return { error: 'no iframe' };
    const doc = iframe.contentDocument;
    const titleInput = doc.querySelector('input[placeholder*="概括视频"]');
    const descEditor = doc.querySelector('.input-editor[data-placeholder="添加描述"]');
    const publishButton = Array.from(doc.querySelectorAll('button'))
      .find(b => (b.textContent || '').trim() === '发表');
    const bodyText = doc.body?.innerText || '';
    const previewVisible = /重新上传|更换视频|上传封面|删除|编辑|封面预览/.test(bodyText) ||
      !!(doc.querySelector('video, canvas, .upload-success, .post-cover-selector'));
    return {
      titleValue: titleInput?.value || '',
      descText: descEditor?.innerText || '',
      publishDisabled: !publishButton || !!publishButton.disabled ||
        String(publishButton.className || '').includes('disabled'),
      publishText: (publishButton?.textContent || '').trim(),
      previewVisible,
    };
  }, [expectedTitle, expectedDesc]);

  if (info.error) throw new Error(`草稿校验失败: ${info.error}`);
  if (info.titleValue !== expectedTitle) {
    console.warn(`[SPH-VIDEO]    ⚠️ 标题校验: 期望="${expectedTitle}" 实际="${info.titleValue}"`);
  }
  if (expectedDesc && !info.descText.includes(expectedDesc)) {
    console.warn(`[SPH-VIDEO]    ⚠️ 描述校验未通过（可能是富文本格式）`);
  }
  if (!info.previewVisible) {
    throw new Error('未检测到视频预览区域');
  }
  if (info.publishDisabled) {
    throw new Error(`发表按钮仍不可用: ${info.publishText}`);
  }
  _log(`[SPH-VIDEO]    校验通过: 标题="${info.titleValue}", 发表="${info.publishText}"`);
}

async function clickPublish(page) {
  _log('[SPH-VIDEO] 点击发表...');
  await page.evaluate(() => {
    const iframe = document.querySelector('iframe[name="content"]') ||
      Array.from(document.querySelectorAll('iframe')).find(f =>
        (f.src || '').includes('micro/content/post'));
    if (!iframe?.contentDocument) return;
    const doc = iframe.contentDocument;
    const publishButton = Array.from(doc.querySelectorAll('button'))
      .find(b => (b.textContent || '').trim() === '发表');
    if (publishButton) publishButton.click();
  });
  await page.waitForTimeout(5000);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { title, desc, video, isDryRun } = parseArgs(process.argv);
  const { winDir, winVideo } = buildWindowsTarget(video);

  _log('[SPH-VIDEO] ========================================');
  _log('[SPH-VIDEO] 视频号视频发布 (Playwright + CDP)');
  _log('[SPH-VIDEO] ========================================');
  _log(`[SPH-VIDEO] 视频: ${video}`);
  _log(`[SPH-VIDEO] 标题: ${title}`);
  _log(`[SPH-VIDEO] 描述: ${desc || '(空)'}`);
  _log(`[SPH-VIDEO] 模式: ${isDryRun ? 'dry-run' : 'publish'}`);

  _log('[SPH-VIDEO] 连接 CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0];
  const { page, createdPage } = await openCreatePage(context);

  page.on('dialog', dialog => {
    _log(`[SPH-VIDEO]    关闭对话框: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });

  try {
    await waitForReady(page);
    await screenshot(page, '01-ready');

    await uploadVideo(page, context, video, { winDir, winVideo });
    await screenshot(page, '02-upload-started');

    await waitForUploadComplete(page);
    await screenshot(page, '03-upload-complete');

    await fillTitle(page, title);
    await fillDescription(page, desc);
    await screenshot(page, '04-filled');

    await verifyDraft(page, title, desc);

    if (isDryRun) {
      _log('[SPH-VIDEO] dry-run 完成，未点击发表');
      return;
    }

    await clickPublish(page);
    await screenshot(page, '05-published');
    await screenshotTo(page, SUCCESS_SHOT);
    _log('[SPH-VIDEO] 发布完成');
  } finally {
    if (createdPage && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    await browser.close();
  }
}

main().catch(error => {
  console.error('[SPH-VIDEO] 发布失败:', error.message);
  process.exit(1);
});
