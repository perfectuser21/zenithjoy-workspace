#!/usr/bin/env node
const _log = console.log.bind(console);
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const CDP_URL = 'http://localhost:19230';
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\zhihu-media';
const HOME_URL = 'https://www.zhihu.com/';
const SCREENSHOTS_DIR = '/tmp/zhihu-idea-screenshots';
const MAX_IMAGES = 9;

const SELECTORS = {
  writeArea: '.WriteArea',
  ideaEntryButton: '.WriteArea button:has-text("发想法")',
  editor: '.WriteArea [contenteditable="true"][role="textbox"]',
  publishButton: '.WriteArea button:has-text("发布")',
  imageInput: '.WriteArea input[type="file"][accept*="image"]',
  toolbarButtons: '.WriteArea button:visible',
  titleInput: '.WriteArea textarea[placeholder="标题"]',
};

function usage() {
  _log('用法: node publish-zhihu-idea.cjs --content "正文内容" [--images "/a.jpg,/b.png"] [--dry-run]');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const contentIndex = args.indexOf('--content');
  const imagesIndex = args.indexOf('--images');
  const dryRun = args.includes('--dry-run');

  const content = contentIndex !== -1 ? args[contentIndex + 1] : '';
  const rawImages = imagesIndex !== -1 ? args[imagesIndex + 1] : '';

  if (!content || content.startsWith('--')) {
    usage();
    throw new Error('必须提供 --content 正文文本');
  }

  const imagePaths = rawImages
    ? rawImages.split(',').map(item => item.trim()).filter(Boolean)
    : [];

  return { content, imagePaths, dryRun };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeSegment(text) {
  return String(text || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'idea';
}

function makeUploadBatchId() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ];
  return `idea-${parts.join('')}`;
}

function toWindowsScpPath(targetPath) {
  return targetPath.replace(/\\/g, '/');
}

function validateImages(imagePaths) {
  if (imagePaths.length > MAX_IMAGES) {
    throw new Error(`知乎想法最多上传 ${MAX_IMAGES} 张图片，当前 ${imagePaths.length} 张`);
  }

  return imagePaths.map(img => {
    const resolved = path.resolve(img);
    if (!fs.existsSync(resolved)) {
      throw new Error(`图片不存在: ${resolved}`);
    }
    return resolved;
  });
}

function buildWindowsImagePaths(localImages, winDir) {
  return localImages.map(image => `${winDir}\\${path.basename(image)}`);
}

function scpToWindows(localImages, winDir) {
  if (!localImages.length) return;

  _log('[ZH-Idea] 0. SCP 图片到 Windows...');
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

  _log(`[ZH-Idea]    ${localImages.length} 张图片已复制到 Windows: ${winDir}`);
}

async function screenshot(page, name) {
  ensureDir(SCREENSHOTS_DIR);
  const output = path.join(SCREENSHOTS_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: output, fullPage: false, timeout: 10000 });
    _log(`[ZH-Idea]    截图: ${output}`);
  } catch (e) {
    _log(`[ZH-Idea]    截图失败(跳过): ${e.message.slice(0, 60)}`);
  }
  return output;
}

async function waitForLogin(page) {
  await page.waitForSelector(SELECTORS.writeArea, { timeout: 30000 });
  const currentUrl = page.url();
  if (/signin|signup|passport\.zhihu\.com/.test(currentUrl)) {
    throw new Error(`知乎登录态失效，当前页面: ${currentUrl}`);
  }
}

async function ensureComposerOpen(page) {
  const entry = page.locator(SELECTORS.ideaEntryButton).first();
  await entry.waitFor({ state: 'visible', timeout: 20000 });
  await entry.click({ timeout: 10000 });
  await page.locator(SELECTORS.editor).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.locator(SELECTORS.publishButton).first().waitFor({ state: 'visible', timeout: 15000 });
}

async function fillContent(page, content) {
  _log('[ZH-Idea] 2. 填写正文...');
  const editor = page.locator(SELECTORS.editor).first();
  await editor.click({ timeout: 10000 });
  await page.keyboard.insertText(content);
  await page.waitForTimeout(1000);

  const text = await editor.innerText();
  if (!text.includes(content.split('\n')[0].slice(0, 10))) {
    throw new Error('正文填充校验失败');
  }
}

async function tryOpenFileChooser(page) {
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
  try {
    await page.locator(`${SELECTORS.writeArea} button:visible`).nth(2).click({ timeout: 5000 });
  } catch (_) {
    await chooserPromise;
    return false;
  }
  const chooser = await chooserPromise;
  return !!chooser;
}

async function resolveFileInputBackendNodeId(page, cdpSession) {
  const selector = SELECTORS.imageInput.replace(/'/g, "\\'");
  const expression = `(() => {
    const walk = root => {
      if (!root) return null;
      const direct = root.querySelector?.('${selector}');
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
  if (!result.objectId) {
    throw new Error('未定位到知乎图片上传 input');
  }

  const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
  if (!node.backendNodeId) {
    throw new Error('未获取到知乎图片上传 backendNodeId');
  }

  return node.backendNodeId;
}

async function uploadImages(page, context, localImages, windowsImages) {
  if (!localImages.length) return;

  _log('[ZH-Idea] 3. 上传图片...');
  const chooserOpened = await tryOpenFileChooser(page);
  _log(`[ZH-Idea]    filechooser: ${chooserOpened ? '已触发' : '未触发，回退隐藏 input'}`);

  const cdpSession = await context.newCDPSession(page);
  const backendNodeId = await resolveFileInputBackendNodeId(page, cdpSession);
  await cdpSession.send('DOM.setFileInputFiles', {
    backendNodeId,
    files: windowsImages,
  });

  await page.waitForTimeout(5000);

  const state = await page.evaluate(selector => {
    const input = document.querySelector(selector);
    const publishButton = Array.from(document.querySelectorAll('.WriteArea button')).find(
      btn => (btn.textContent || '').trim() === '发布'
    );
    const areaText = document.querySelector('.WriteArea')?.innerText || '';
    return {
      fileCount: input?.files?.length || 0,
      publishDisabled: publishButton ? publishButton.disabled : null,
      areaText: areaText.slice(0, 200),
    };
  }, SELECTORS.imageInput);

  if (state.fileCount !== windowsImages.length) {
    throw new Error(`图片上传校验失败，input.files=${state.fileCount}，期望 ${windowsImages.length}`);
  }

  _log(`[ZH-Idea]    图片已写入 input.files=${state.fileCount}`);
}

async function verifyReady(page, expectedContent, expectedImageCount) {
  _log('[ZH-Idea] 4. 校验发布态...');
  const result = await page.evaluate(({ content, imageSelector }) => {
    const editor = document.querySelector('.WriteArea [contenteditable="true"][role="textbox"]');
    const publishButton = Array.from(document.querySelectorAll('.WriteArea button')).find(
      btn => (btn.textContent || '').trim() === '发布'
    );
    const input = document.querySelector(imageSelector);

    return {
      editorText: (editor?.innerText || '').trim(),
      publishDisabled: publishButton ? publishButton.disabled : null,
      fileCount: input?.files?.length || 0,
    };
  }, { content: expectedContent, imageSelector: SELECTORS.imageInput });

  if (!result.editorText.includes(expectedContent.split('\n')[0].slice(0, 10))) {
    throw new Error('发布前校验失败：正文未出现在编辑器中');
  }
  if (result.publishDisabled) {
    throw new Error('发布前校验失败：发布按钮仍然禁用');
  }
  if (expectedImageCount !== result.fileCount) {
    throw new Error(`发布前校验失败：图片数 ${result.fileCount}，期望 ${expectedImageCount}`);
  }

  _log(`[ZH-Idea]    校验通过: 正文已填充, 图片 ${result.fileCount} 张`);
}

async function publish(page) {
  _log('[ZH-Idea] 5. 点击发布...');
  // 用 JS 点击避免 div 遮挡导致 Playwright click 超时
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.WriteArea button')).find(
      b => (b.textContent || '').trim() === '发布'
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(5000);

  const success = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const editor = document.querySelector('.WriteArea [contenteditable="true"][role="textbox"]');
    const publishButton = Array.from(document.querySelectorAll('.WriteArea button')).find(
      btn => (btn.textContent || '').trim() === '发布'
    );
    return {
      hasToast: /发布成功|已发布|分享成功/.test(text),
      editorCleared: !(editor?.innerText || '').trim(),
      publishDisabled: publishButton ? publishButton.disabled : null,
    };
  });

  if (!success.hasToast && !success.editorCleared) {
    console.warn('[ZH-Idea]    未捕获到明确成功提示，请检查截图确认');
  }
}

async function main() {
  const { content, imagePaths, dryRun } = parseArgs(process.argv);
  const localImages = validateImages(imagePaths);
  const batchId = makeUploadBatchId();
  const slug = sanitizeSegment(path.basename(localImages[0] || 'no-image'));
  const winDir = `${WINDOWS_BASE_DIR}\\${batchId}-${slug}`;
  const windowsImages = buildWindowsImagePaths(localImages, winDir);

  _log('[ZH-Idea] ========================================');
  _log('[ZH-Idea] 知乎想法发布');
  _log('[ZH-Idea] ========================================');
  _log(`[ZH-Idea] 正文长度: ${content.length}`);
  _log(`[ZH-Idea] 图片数量: ${localImages.length}`);
  _log(`[ZH-Idea] 模式: ${dryRun ? 'dry-run' : 'publish'}`);

  if (localImages.length) {
    _log(`[ZH-Idea] Windows 目录: ${winDir}`);
  }

  if (localImages.length) {
    scpToWindows(localImages, winDir);
  }

  ensureDir(SCREENSHOTS_DIR);

  _log('[ZH-Idea] 1. 连接远端 Chrome CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30000 });
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  page.on('dialog', dialog => {
    _log(`[ZH-Idea]    自动关闭对话框: ${dialog.message()}`);
    dialog.dismiss().catch(() => {});
  });

  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    await waitForLogin(page);
    await screenshot(page, '01-home');

    await ensureComposerOpen(page);
    await screenshot(page, '02-composer-open');

    await fillContent(page, content);

    if (localImages.length) {
      await uploadImages(page, context, localImages, windowsImages);
    }

    await screenshot(page, '03-filled');
    await verifyReady(page, content, localImages.length);

    if (dryRun) {
      _log('[ZH-Idea] dry-run 完成，未点击发布');
      return;
    }

    await publish(page);
    await screenshot(page, '04-published');
    _log('[ZH-Idea] 发布流程完成');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[ZH-Idea] 发布失败: ${error.message}`);
  process.exit(1);
});
