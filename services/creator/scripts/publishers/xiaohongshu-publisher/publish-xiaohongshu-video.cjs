#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 小红书视频发布脚本
 *
 * 方案：CDP UI 自动化（Input.dispatchMouseEvent + Page.fileChooserOpened）
 *   - 连接已登录的小红书 Chrome：100.97.242.124:19224
 *   - 视频先通过 xian-mac 跳板 SCP 到 Windows
 *   - 打开发布页后使用 file chooser 上传视频，填写标题/正文/标签并发布
 *
 * 用法：
 *   node publish-xiaohongshu-video.cjs \
 *       --title "标题" \
 *       --video /path/to/video.mp4 \
 *       --desc "正文" \
 *       --tags "标签1,标签2"
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { CDPClient } = require('../weibo-publisher/cdp-client.cjs');
const { escapeForJS } = require('./utils.cjs');

const CDP_HOST = process.env.XHS_CDP_HOST || '100.97.242.124';
const CDP_PORT = Number(process.env.XHS_CDP_PORT || 19224);
const WINDOWS_IP = process.env.XHS_WINDOWS_IP || '100.97.242.124';
const WINDOWS_USER = process.env.XHS_WINDOWS_USER || 'xuxia';
const WINDOWS_BASE_DIR = process.env.XHS_WINDOWS_BASE_DIR || 'C:\\Users\\xuxia\\xiaohongshu-media';
const SCREENSHOTS_DIR = process.env.XHS_SCREENSHOTS_DIR || '/tmp/xiaohongshu-video-publish-screenshots';
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
    .slice(0, 80) || 'video';
}

function buildTagText(tags) {
  return tags
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');
}

function buildDescription(desc, tags) {
  const cleanDesc = (desc || '').trim();
  const tagText = buildTagText(tags);
  if (cleanDesc && tagText) return `${cleanDesc}\n\n${tagText}`;
  return cleanDesc || tagText;
}

function isLoginError(url) {
  if (!url) return false;
  return url.includes('login') || url.includes('passport');
}

function isPublishSuccess(url, bodyText) {
  const successKeywords = ['发布成功', '笔记发布成功', '笔记已发布', '创作成功'];
  return successKeywords.some(kw => (bodyText || '').includes(kw)) || (url && !url.includes('/publish/'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = name => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : '';
  };

  if (args.includes('--help') || args.includes('-h')) {
    _log('用法：node publish-xiaohongshu-video.cjs --title "标题" --video /path/to/video.mp4 --desc "正文" --tags "标签1,标签2"');
    process.exit(0);
  }

  const video = get('--video');
  if (!video) {
    console.error('❌ 必须提供 --video 参数');
    process.exit(1);
  }

  const title = get('--title').trim();
  const desc = get('--desc').trim();
  const tagsRaw = get('--tags').trim();
  const tags = tagsRaw ? tagsRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
  const isDryRun = args.includes('--dry-run');

  return { title, desc, tags, video: path.resolve(video), isDryRun };
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 45 });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.jpg`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    _log(`[XHS-VIDEO]    截图: ${filepath}`);
    return filepath;
  } catch (err) {
    console.warn(`[XHS-VIDEO]    截图失败: ${err.message}`);
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

function makeWindowsTarget(videoPath) {
  const now = new Date();
  const dateDir = now.toISOString().slice(0, 10);
  const baseName = sanitizePathSegment(path.basename(videoPath, path.extname(videoPath)));
  const uniqueDir = `${baseName}-${Date.now()}`;
  const windowsDir = path.join(WINDOWS_BASE_DIR, dateDir, uniqueDir).replace(/\//g, '\\');
  const windowsVideo = path.join(windowsDir, path.basename(videoPath)).replace(/\//g, '\\');
  return { windowsDir, windowsVideo, dateDir, uniqueDir };
}

function run(cmd, timeout = 30000) {
  return execSync(cmd, { timeout, stdio: 'pipe' });
}

function scpVideoToWindows(localVideo, windowsDir) {
  const filename = path.basename(localVideo);
  const winDirForward = windowsDir.replace(/\\/g, '/');

  _log('[XHS-VIDEO] 0️⃣  复制视频到 Windows（直连）...');
  run(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} ` +
    `"powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirForward}' | Out-Null\\""`,
    15000
  );
  run(
    `scp -o StrictHostKeyChecking=no ${JSON.stringify(localVideo)} ` +
    `${WINDOWS_USER}@${WINDOWS_IP}:${JSON.stringify(`${winDirForward}/${filename}`)}`,
    600000
  );
  _log('[XHS-VIDEO]    ✅ 视频已复制到 Windows');
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
  await sleep(120);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function ensureVideoTab(cdp) {
  const tab = await evalValue(cdp, `(function() {
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll('button,div,span,a')).filter(visible);
    const active = nodes.find(el => /上传视频/.test((el.textContent || '').trim()) && /active/.test(el.className || ''));
    if (active) return { already: true };
    const target = nodes.find(el => (el.textContent || '').trim() === '上传视频');
    if (!target) return { found: false };
    const r = target.getBoundingClientRect();
    return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  if (tab?.already) {
    _log('[XHS-VIDEO]    当前已是视频发布页');
    return;
  }
  if (!tab?.found) {
    console.warn('[XHS-VIDEO]    ⚠️  未找到"上传视频"tab，继续尝试当前页面');
    return;
  }

  _log('[XHS-VIDEO] 2️⃣  切换到视频发布模式...');
  await clickAt(cdp, tab.x, tab.y);
  await sleep(1500);
}

async function uploadVideo(cdp, windowsVideo) {
  _log('[XHS-VIDEO] 3️⃣  上传视频...');
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

  const chooserPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('File chooser timeout 15s')), 15000);
    cdp.on('Page.fileChooserOpened', params => {
      clearTimeout(timer);
      resolve(params);
    });
  });

  const uploadBtn = await evalValue(cdp, `(function() {
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const scoreText = text => {
      if (text === '拖拽视频到此或点击上传') return 120;
      if (text === '点击上传') return 110;
      if (text === '选择文件') return 100;
      if (text === '上传视频') return 80;
      return 0;
    };
    const candidates = [];
    const nodes = Array.from(document.querySelectorAll('button,div,label,p,span')).filter(visible);
    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (!['上传视频', '拖拽视频到此或点击上传', '点击上传', '选择文件'].includes(text)) continue;
      if ((node.className || '').includes('creator-tab')) continue;
      const r = node.getBoundingClientRect();
      candidates.push({
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        text,
        tag: node.tagName,
        className: node.className || '',
        score:
          scoreText(text) +
          (node.tagName === 'BUTTON' ? 30 : 0) +
          ((node.className || '').includes('upload-button') ? 50 : 0) +
          Math.round(r.top / 10)
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0]) return candidates[0];

    const input = document.querySelector('input[type="file"].upload-input, input[type="file"]');
    if (input) {
      const host = input.closest('button') || input.closest('label') || input.closest('div') || input.parentElement;
      if (host && visible(host)) {
        const r = host.getBoundingClientRect();
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          text: 'file-input-host',
          tag: host.tagName,
          className: host.className || '',
          score: 1
        };
      }
    }
    return null;
  })()`);

  if (!uploadBtn) {
    await screenshot(cdp, '03-no-upload-button');
    throw new Error('未找到视频上传入口');
  }

  _log(`[XHS-VIDEO]    上传入口: ${uploadBtn.text} <${uploadBtn.tag || 'unknown'}> (${uploadBtn.x}, ${uploadBtn.y})`);
  await clickAt(cdp, uploadBtn.x, uploadBtn.y);

  const chooser = await chooserPromise;
  _log(`[XHS-VIDEO]    文件选择器 backendNodeId: ${chooser.backendNodeId}`);
  await cdp.send('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [windowsVideo] });
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
}

async function waitForUploadReady(cdp) {
  _log('[XHS-VIDEO]    等待上传与转码完成...');
  for (let i = 0; i < 300; i++) {
    await sleep(1000);
    const state = await evalValue(cdp, `(function() {
      const visible = el => {
        if (!el) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const body = document.body.innerText || '';
      const titleInput = Array.from(document.querySelectorAll('input,textarea'))
        .find(el => visible(el) && /标题/.test(el.placeholder || ''));
      const editor = Array.from(document.querySelectorAll('textarea,[contenteditable="true"]'))
        .find(el => visible(el));
      const publishBtn = Array.from(document.querySelectorAll('button,div,span'))
        .find(el => visible(el) && (el.textContent || '').trim() === '发布');
      const stillUploading = /上传中|处理中|转码中|校验中|检测中|封面生成中/.test(body);
      return {
        ready: !!titleInput || (!!editor && !!publishBtn) || (body.includes('话题') && !!publishBtn),
        stillUploading,
        body: body.slice(0, 300),
      };
    })()`);

    if (state.ready && !state.stillUploading) {
      _log(`[XHS-VIDEO]    上传完成（${i + 1}s）`);
      return;
    }
    if ((i + 1) % 15 === 0) {
      _log(`[XHS-VIDEO]    ... ${i + 1}s`);
    }
  }
  throw new Error('等待视频上传完成超时（300s）');
}

async function fillTitle(cdp, title) {
  if (!title) return;
  _log('[XHS-VIDEO] 4️⃣  填写标题...');
  const escapedTitle = escapeForJS(title);
  const ok = await evalValue(cdp, `(function() {
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const selectors = [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[class*="title"]',
      'textarea[class*="title"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && visible(el)) {
        el.focus();
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, '${escapedTitle}');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  })()`);

  if (!ok) {
    console.warn('[XHS-VIDEO]    ⚠️  未找到标题输入框');
  }
  await sleep(500);
}

async function fillDescription(cdp, description) {
  if (!description) return;
  _log(`[XHS-VIDEO] 5️⃣  填写正文/标签（${description.length} 字符）...`);

  const target = await evalValue(cdp, `(function() {
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const candidates = [
      'div[contenteditable="true"][placeholder*="描述"]',
      'div[contenteditable="true"][placeholder*="正文"]',
      'div[contenteditable="true"][placeholder*="简介"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="简介"]',
      '.ql-editor',
      'div[contenteditable="true"]',
      'textarea'
    ];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (!el || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + Math.min(r.height / 2, 40)),
        selector,
        isTextControl: el.tagName === 'TEXTAREA'
      };
    }
    return null;
  })()`);

  if (!target) {
    console.warn('[XHS-VIDEO]    ⚠️  未找到正文编辑区');
    return;
  }

  await clickAt(cdp, target.x, target.y);
  await sleep(250);

  await evalValue(cdp, `(function() {
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const candidates = [
      'div[contenteditable="true"][placeholder*="描述"]',
      'div[contenteditable="true"][placeholder*="正文"]',
      'div[contenteditable="true"][placeholder*="简介"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="简介"]',
      '.ql-editor',
      'div[contenteditable="true"]',
      'textarea'
    ];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (!el || !visible(el)) continue;
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, '');
      } else if (el.isContentEditable) {
        el.innerHTML = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return false;
  })()`);

  await cdp.send('Input.insertText', { text: description });
  await sleep(600);
}

async function findPublishButton(cdp, texts) {
  const escapedTexts = JSON.stringify(texts);
  return evalValue(cdp, `(function() {
    const targetTexts = ${escapedTexts};
    const visible = el => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const nodes = Array.from(document.querySelectorAll('button,div,span,a')).filter(visible);
    for (const text of targetTexts) {
      const el = nodes.find(node => (node.textContent || '').trim() === text && !node.hasAttribute('disabled') && node.getAttribute('aria-disabled') !== 'true');
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = el.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text };
      }
    }
    return { found: false };
  })()`);
}

async function clickPublish(cdp) {
  _log('[XHS-VIDEO] 6️⃣  点击发布...');
  const publishBtn = await findPublishButton(cdp, ['发布', '发布笔记']);
  if (!publishBtn?.found) {
    await screenshot(cdp, '06-no-publish-button');
    throw new Error('未找到发布按钮');
  }

  await clickAt(cdp, publishBtn.x, publishBtn.y);
  await sleep(3000);

  const confirmBtn = await findPublishButton(cdp, ['确认发布', '继续发布', '确认']);
  if (confirmBtn?.found) {
    await clickAt(cdp, confirmBtn.x, confirmBtn.y);
    await sleep(3000);
  }
}

async function printCurrentState(cdp, label) {
  const state = await evalValue(cdp, `JSON.stringify({
    url: location.href,
    title: document.title,
    body: (document.body && document.body.innerText ? document.body.innerText.slice(0, 1000) : '')
  })`);
  _log(`[XHS-VIDEO] ${label}: ${state}`);
}

async function main() {
  const { title, desc, tags, video, isDryRun } = parseArgs(process.argv);
  const description = buildDescription(desc, tags);

  if (!fs.existsSync(video)) {
    console.error(`❌ 视频不存在: ${video}`);
    process.exit(1);
  }

  const { windowsDir, windowsVideo } = makeWindowsTarget(video);
  ensureDir(SCREENSHOTS_DIR);

  _log('\n[XHS-VIDEO] ========================================');
  _log('[XHS-VIDEO] 小红书视频发布');
  _log('[XHS-VIDEO] ========================================\n');
  _log(`[XHS-VIDEO] 视频: ${video}`);
  _log(`[XHS-VIDEO] Windows 目标: ${windowsVideo}`);
  _log(`[XHS-VIDEO] 标题: ${title || '（无）'}`);
  _log(`[XHS-VIDEO] 正文: ${desc ? `${desc.length} 字符` : '（无）'}`);
  _log(`[XHS-VIDEO] 标签: ${tags.length ? tags.join(', ') : '（无）'}`);

  if (isDryRun) {
    _log('[XHS-VIDEO] dry-run 模式，跳过 SCP/CDP');
    return;
  }

  let cdp;
  try {
    scpVideoToWindows(video, windowsDir);

    _log('\n[XHS-VIDEO] 连接 CDP...');
    cdp = await connectCDP();
    _log('[XHS-VIDEO] ✅ CDP 已连接');

    await printCurrentState(cdp, '当前状态');
    await screenshot(cdp, '00-current');

    _log('[XHS-VIDEO] 1️⃣  导航到发布页...');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(6000);

    const currentUrl = await evalValue(cdp, 'location.href');
    if (isLoginError(currentUrl)) {
      throw new Error(`小红书未登录，请在 Chrome (${CDP_PORT}) 登录`);
    }

    await printCurrentState(cdp, '发布页状态');
    await screenshot(cdp, '01-publish');
    await ensureVideoTab(cdp);

    await uploadVideo(cdp, windowsVideo);
    await waitForUploadReady(cdp);
    await screenshot(cdp, '03-uploaded');

    await fillTitle(cdp, title);
    await fillDescription(cdp, description);
    await screenshot(cdp, '05-filled');

    await clickPublish(cdp);
    await screenshot(cdp, '06-after-publish');

    const finalUrl = await evalValue(cdp, 'location.href');
    const bodyText = await evalValue(cdp, 'document.body.innerText.slice(0, 1000)');
    if (isPublishSuccess(finalUrl, bodyText)) {
      _log('\n[XHS-VIDEO] ✅ 发布成功');
    } else {
      _log('\n[XHS-VIDEO] ⚠️  发布状态不确定，请检查截图和页面');
    }
    _log(`[XHS-VIDEO] 最终 URL: ${finalUrl}`);
    _log(`[XHS-VIDEO] 截图目录: ${SCREENSHOTS_DIR}`);
  } catch (err) {
    console.error(`\n[XHS-VIDEO] ❌ 发布失败: ${err.message}`);
    if (cdp) {
      await screenshot(cdp, 'error').catch(() => {});
    }
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildTagText,
  buildDescription,
  isLoginError,
  isPublishSuccess,
  makeWindowsTarget,
  parseArgs,
  sanitizePathSegment,
};
