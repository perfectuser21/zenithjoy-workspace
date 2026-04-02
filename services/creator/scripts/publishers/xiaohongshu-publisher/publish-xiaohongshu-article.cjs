const _log = console.log.bind(console);
#!/usr/bin/env node
'use strict';

/**
 * 小红书长文发布脚本
 *
 * 方案：CDP UI 自动化（连接已登录 Chrome）
 * 流程：写长文 -> 新的创作 -> 输入标题/正文 -> 一键排版 -> 可选上传封面 -> 发布
 *
 * 说明：
 *   - --content 支持纯文本，或传入 HTML 字符串 / HTML 文件路径；HTML 会转换为纯文本后写入编辑器
 *   - --cover 可选；提供时会作为最终发布页的封面图上传
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { CDPClient } = require('../weibo-publisher/cdp-client.cjs');
const { escapeForJS } = require('./utils.cjs');

const CDP_HOST = process.env.XHS_CDP_HOST || '100.97.242.124';
const CDP_PORT = Number(process.env.XHS_CDP_PORT || 19224);
const WINDOWS_IP = process.env.XHS_WINDOWS_IP || '100.97.242.124';
const WINDOWS_USER = process.env.WINDOWS_USER || 'xuxia';
const WINDOWS_BASE_DIR = process.env.XHS_WINDOWS_BASE_DIR || 'C:\\Users\\xuxia\\xiaohongshu-media';
const SCREENSHOTS_DIR = process.env.XHS_SCREENSHOTS_DIR || '/tmp/xiaohongshu-article-publish-screenshots';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official';
const XHS_DOMAIN = 'creator.xiaohongshu.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizePathSegment(input) {
  return (input || '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'article';
}

function isLoginError(url) {
  if (!url) return false;
  return url.includes('login') || url.includes('passport');
}

function isPublishSuccess(url, bodyText) {
  const successKeywords = ['发布成功', '笔记发布成功', '笔记已发布', '创作成功'];
  return successKeywords.some(kw => (bodyText || '').includes(kw)) || (url && !url.includes('/publish/'));
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<(p|div|li|h[1-6]|ul|ol|blockquote|section|article)[^>]*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadContent(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return '';
  if (fs.existsSync(value) && fs.statSync(value).isFile()) {
    const fileText = fs.readFileSync(value, 'utf8');
    return path.extname(value).toLowerCase() === '.html' ? htmlToPlainText(fileText) : fileText.trim();
  }
  if (/<[a-z][\s\S]*>/i.test(value)) {
    return htmlToPlainText(value);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = name => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : '';
  };

  if (args.includes('--help') || args.includes('-h')) {
    _log('用法：node publish-xiaohongshu-article.cjs --title "标题" --content "正文或HTML" [--cover /path/to/cover.png]');
    _log('选项：');
    _log('  --title <text>    长文标题（必填）');
    _log('  --content <text>  正文文本 / HTML 字符串 / 文件路径（必填）');
    _log('  --cover <path>    封面图片路径（可选）');
    _log('  --dry-run         仅打印参数，不连接 CDP');
    process.exit(0);
  }

  const title = get('--title').trim();
  const contentRaw = get('--content');
  const cover = get('--cover').trim();
  const isDryRun = args.includes('--dry-run');

  if (!title) {
    console.error('❌ 必须提供 --title 参数');
    process.exit(1);
  }
  if (!contentRaw) {
    console.error('❌ 必须提供 --content 参数');
    process.exit(1);
  }

  const content = loadContent(contentRaw);
  if (!content) {
    console.error('❌ 正文为空，无法发布');
    process.exit(1);
  }

  if (cover && !fs.existsSync(cover)) {
    console.error(`❌ 封面文件不存在: ${cover}`);
    process.exit(1);
  }

  return {
    title,
    content,
    cover: cover ? path.resolve(cover) : '',
    isDryRun,
  };
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 45 });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.jpg`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    _log(`[XHS-ARTICLE]    截图: ${filepath}`);
    return filepath;
  } catch (err) {
    console.warn(`[XHS-ARTICLE]    截图失败: ${err.message}`);
    return null;
  }
}

async function getPagesData() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', err => reject(new Error(`CDP 连接失败 (${CDP_HOST}:${CDP_PORT}): ${err.message}`)));
  });
}

async function connectCDP() {
  const pages = await getPagesData();
  const xhsPage = pages.find(p => p.type === 'page' && p.url.includes(XHS_DOMAIN));
  const targetPage = xhsPage || pages.find(p => p.type === 'page');
  if (!targetPage) {
    throw new Error(`未找到浏览器页面，请在 Chrome (${CDP_PORT}) 中打开小红书创作平台`);
  }

  const cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  return cdp;
}

async function evalValue(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return result.result.value;
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(100);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function waitFor(cdp, description, expression, timeoutMs = 20000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evalValue(cdp, expression);
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`等待超时: ${description}`);
}

async function clickText(cdp, text, timeoutMs = 15000) {
  const escaped = escapeForJS(text);
  const point = await waitFor(
    cdp,
    `点击文本 ${text}`,
    `(function() {
      const visible = el => {
        if (!el || !el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const nodes = Array.from(document.querySelectorAll('button,div,span,a')).filter(visible);
      const el = nodes.find(node => (node.textContent || '').replace(/\\s+/g, ' ').trim() === '${escaped}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`,
    timeoutMs
  );
  await clickAt(cdp, point.x, point.y);
}

function makeWindowsWorkspace(title) {
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const uniqueDir = `${sanitizePathSegment(title)}-${Date.now()}`;
  const windowsDir = path.join(WINDOWS_BASE_DIR, dateDir, uniqueDir).replace(/\//g, '\\');
  return { windowsDir, dateDir, uniqueDir };
}

function scpFileToWindows(localFile, windowsDir) {
  const filename = path.basename(localFile);
  const winDirForward = windowsDir.replace(/\\/g, '/');

  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirForward}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );
  execSync(
    `scp -o StrictHostKeyChecking=no "${localFile}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirForward}/${filename}"`,
    { timeout: 60000, stdio: 'pipe' }
  );

  return path.join(windowsDir, filename).replace(/\//g, '\\');
}

async function setTextareaValue(cdp, selector, value) {
  const escapedSelector = escapeForJS(selector);
  const escapedValue = escapeForJS(value);
  const ok = await evalValue(cdp, `(function() {
    const el = document.querySelector('${escapedSelector}');
    if (!el || !el.offsetParent) return false;
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, '${escapedValue}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`未找到输入框: ${selector}`);
}

async function focusAndInsertText(cdp, selector, text, chunkSize = 800) {
  const escapedSelector = escapeForJS(selector);
  const point = await evalValue(cdp, `(function() {
    const el = document.querySelector('${escapedSelector}');
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 24), y: Math.round(r.top + 24) };
  })()`);
  if (!point) throw new Error(`未找到编辑区域: ${selector}`);

  await clickAt(cdp, point.x, point.y);
  await sleep(200);
  for (let i = 0; i < text.length; i += chunkSize) {
    await cdp.send('Input.insertText', { text: text.slice(i, i + chunkSize) });
    await sleep(80);
  }
}

async function uploadCover(cdp, windowsCoverPath) {
  _log('[XHS-ARTICLE] 5️⃣  上传封面...');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

  const chooserPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('封面文件选择器超时')), 12000);
    cdp.on('Page.fileChooserOpened', params => {
      clearTimeout(timer);
      resolve(params);
    });
  });

  const point = await waitFor(
    cdp,
    '封面上传入口',
    `(function() {
      const el = document.querySelector('.img-upload-area .entry');
      if (!el || !el.offsetParent) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`
  );

  await clickAt(cdp, point.x, point.y);
  const chooser = await chooserPromise;
  await cdp.send('DOM.setFileInputFiles', {
    backendNodeId: chooser.backendNodeId,
    files: [windowsCoverPath],
  });
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
  await sleep(4000);
}

async function main(opts) {
  ensureDir(SCREENSHOTS_DIR);
  const { title, content, cover, isDryRun } = opts;

  _log('\n[XHS-ARTICLE] ========================================');
  _log('[XHS-ARTICLE] 小红书长文发布');
  _log('[XHS-ARTICLE] ========================================\n');
  _log(`[XHS-ARTICLE] 标题: ${title}`);
  _log(`[XHS-ARTICLE] 正文长度: ${content.length} 字符`);
  _log(`[XHS-ARTICLE] 封面: ${cover || '（使用默认模板封面）'}`);

  if (isDryRun) {
    _log('\n[XHS-ARTICLE] dry-run 模式，跳过 CDP');
    return;
  }

  const windowsWorkspace = makeWindowsWorkspace(title);
  const windowsCover = cover ? scpFileToWindows(cover, windowsWorkspace.windowsDir) : '';
  if (windowsCover) {
    _log(`[XHS-ARTICLE] 封面已复制到 Windows: ${windowsCover}`);
  }

  let cdp;
  try {
    cdp = await connectCDP();
    _log('[XHS-ARTICLE] ✅ CDP 已连接');

    _log('[XHS-ARTICLE] 1️⃣  打开发布页...');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-publish-page');

    const currentUrl = await evalValue(cdp, 'location.href');
    if (isLoginError(currentUrl)) {
      throw new Error(`小红书未登录，请在 Chrome (${CDP_PORT}) 中登录`);
    }

    _log('[XHS-ARTICLE] 2️⃣  进入长文创作...');
    await clickText(cdp, '写长文');
    await waitFor(cdp, '长文首页', `document.body.innerText.includes('新的创作')`, 15000);
    await screenshot(cdp, '02-article-home');
    await clickText(cdp, '新的创作');

    _log('[XHS-ARTICLE] 3️⃣  填写标题与正文...');
    await waitFor(cdp, '长文标题输入框', `!!document.querySelector('textarea[placeholder="输入标题"]')`, 15000);
    await setTextareaValue(cdp, 'textarea[placeholder="输入标题"]', title.slice(0, 64));
    await focusAndInsertText(cdp, '.rich-editor-content .ProseMirror, .rich-editor-content [contenteditable="true"], .tiptap.ProseMirror', content);
    await sleep(1000);
    await screenshot(cdp, '03-editor-filled');

    _log('[XHS-ARTICLE] 4️⃣  一键排版并进入发布页...');
    await clickText(cdp, '一键排版');
    await waitFor(cdp, '封面设置页', `document.body.innerText.includes('封面设置') && document.body.innerText.includes('下一步')`, 20000);
    await screenshot(cdp, '04-template-page');
    await clickText(cdp, '下一步');

    await waitFor(cdp, '最终发布页', `document.body.innerText.includes('发布') && !!document.querySelector('input[placeholder="填写标题会有更多赞哦"]')`, 20000);
    await setTextareaValue(cdp, 'input[placeholder="填写标题会有更多赞哦"]', title);

    const summary = content.slice(0, 1000);
    if (summary) {
      const existing = await evalValue(cdp, `(function() {
        const el = document.querySelector('.publish-page-content-base .tiptap.ProseMirror');
        return !!(el && el.offsetParent);
      })()`);
      if (existing) {
        await focusAndInsertText(cdp, '.publish-page-content-base .tiptap.ProseMirror', summary);
      }
    }

    if (windowsCover) {
      await uploadCover(cdp, windowsCover);
    }

    await screenshot(cdp, '05-before-publish');

    _log('[XHS-ARTICLE] 6️⃣  点击发布...');
    await clickText(cdp, '发布');
    await sleep(5000);
    await screenshot(cdp, '06-after-publish');

    const finalUrl = await evalValue(cdp, 'location.href');
    const bodyText = await evalValue(cdp, 'document.body.innerText.slice(0, 2000)');
    if (isPublishSuccess(finalUrl, bodyText)) {
      _log('[XHS-ARTICLE] ✅ 发布成功');
      _log(`[XHS-ARTICLE] 最终 URL: ${finalUrl}`);
    } else {
      _log('[XHS-ARTICLE] ⚠️  发布状态不确定，请检查截图');
      _log(`[XHS-ARTICLE] 当前 URL: ${finalUrl}`);
    }
    _log(`[XHS-ARTICLE] 截图目录: ${SCREENSHOTS_DIR}`);
  } catch (err) {
    console.error(`\n[XHS-ARTICLE] ❌ 发布失败: ${err.message}`);
    if (cdp) {
      await screenshot(cdp, 'error').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

if (require.main === module) {
  main(parseArgs(process.argv));
}

module.exports = {
  htmlToPlainText,
  loadContent,
  isLoginError,
  isPublishSuccess,
};
