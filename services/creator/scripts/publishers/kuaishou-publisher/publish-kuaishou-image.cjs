#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 快手图文发布脚本 v2
 *
 * 方案：CDP UI 自动化（Input.dispatchMouseEvent + Page.fileChooserOpened）
 *   - 端口：19223（专用快手 Chrome 实例）
 *   - SCP：通过 xian-mac 跳板复制图片到 Windows
 *   - 音乐：点击"添加音乐" → 搜索 → 选第一个（失败降级跳过）
 *   - 最多 4 个话题标签（快手限制）
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-kuaishou-image.cjs --content /path/to/image-1/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选，#话题# 最多 4 个）
 *   music.txt     - 音乐搜索词（可选，默认搜索"热歌"）
 *   image.jpg     - 图片（支持 image1.jpg...，最多 8 张）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 *   xian-mac SSH 可达，且 xian-mac 上有 ~/.ssh/windows_ed 密钥
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

const {
  findImages,
  readContent,
  convertToWindowsPaths,
  extractDirNames,
  truncateHashtags,
  readMusicQuery,
} = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================
const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const SCREENSHOTS_DIR = '/tmp/kuaishou-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\kuaishou-media';
const PUBLISH_URL = 'https://cp.kuaishou.com/article/publish/video';
const KS_DOMAIN = 'cp.kuaishou.com';
// ============================================================
// 纯函数
// ============================================================

function isLoginError(url) {
  if (!url) return false;
  return url.includes('passport.kuaishou.com') || url.includes('/account/login');
}

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// SCP：直接从 Mac 复制图片到 Windows
// ============================================================
function scpImagesToWindows(localImages, windowsDir) {
  _log(`[KS] SCP 图片到 Windows（直连 ${WINDOWS_IP}）...`);

  const winDirForward = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirForward}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );

  for (const imgPath of localImages) {
    const fname = path.basename(imgPath);
    execSync(
      `scp -o StrictHostKeyChecking=no "${imgPath}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirForward}/${fname}"`,
      { timeout: 60000, stdio: 'pipe' }
    );
    _log(`[KS]    已传输: ${fname}`);
  }

  _log(`[KS]    ${localImages.length} 张图片已复制到 Windows`);
}

// ============================================================
// CDP WebSocket 封装
// ============================================================
async function createCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = {};
  const evL = {};

  ws.on('message', raw => {
    const d = JSON.parse(raw);
    if (d.id && pending[d.id]) { pending[d.id](d.result); delete pending[d.id]; }
    if (d.method) { (evL[d.method] || []).forEach(cb => cb(d.params)); }
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending[id] = resolve;
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { delete pending[id]; reject(new Error(`CDP 超时: ${method}`)); }, 25000);
  });

  const on = (event, cb) => {
    evL[event] = evL[event] || [];
    evL[event].push(cb);
  };

  const eval_ = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r?.result?.value;
  };

  const screenshot = async (name) => {
    try {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 50 });
      const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
      fs.writeFileSync(filepath, Buffer.from(r.data, 'base64'));
      _log(`[KS]    截图: ${filepath}`);
    } catch (e) {
      _log(`[KS]    截图失败: ${e.message}`);
    }
  };

  const close = () => ws.close();

  return { send, on, eval_, screenshot, close };
}

// ============================================================
// 音乐选择（失败降级跳过）
// ============================================================
async function addMusic(cdp, musicQuery) {
  _log(`\n[KS] 选择背景音乐（搜索：${musicQuery}）...`);
  try {
    const musicBtn = await cdp.eval_(`(function() {
      const all = Array.from(document.querySelectorAll('*'));
      for (const el of all) {
        const t = el.textContent.trim();
        if ((t === '添加音乐' || t === '选择音乐' || t === '背景音乐') && el.offsetParent !== null) {
          const r = el.getBoundingClientRect();
          return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        }
      }
      return { found: false };
    })()`);

    if (!musicBtn?.found) {
      _log('[KS]    未找到音乐按钮，跳过音乐选择');
      return;
    }

    const { x, y } = musicBtn;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(2000);

    const searchInput = await cdp.eval_(`(function() {
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input[placeholder*="搜索"], input[placeholder*="音乐"]'));
      const inp = inputs.find(i => i.offsetParent !== null);
      if (inp) {
        inp.focus();
        const r = inp.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
      return { found: false };
    })()`);

    if (!searchInput?.found) {
      _log('[KS]    未找到音乐搜索框，跳过');
      return;
    }

    const { x: sx, y: sy } = searchInput;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(200);
    await cdp.send('Input.insertText', { text: musicQuery });
    await sleep(300);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(2500);

    const firstResult = await cdp.eval_(`(function() {
      const items = Array.from(document.querySelectorAll('[class*="music-item"], [class*="song-item"], [class*="list-item"], [class*="music_item"]'));
      const first = items.find(i => i.offsetParent !== null);
      if (first) { first.click(); return { clicked: true }; }
      const useBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '使用' && b.offsetParent !== null);
      if (useBtn) { useBtn.click(); return { clicked: true, via: 'use-btn' }; }
      return { clicked: false };
    })()`);

    if (firstResult?.clicked) {
      await sleep(1000);
      _log('[KS]    音乐已选择');
    } else {
      _log('[KS]    未找到音乐列表结果，跳过');
    }
  } catch (e) {
    console.warn(`[KS]    音乐选择失败（降级跳过）: ${e.message}`);
  }
}

// ============================================================
// 主流程
// ============================================================
async function main(contentDir, contentText, windowsImages, musicQuery, isDryRun) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  _log('\n[KS] ========================================');
  _log('[KS] 快手图文发布 v2');
  _log('[KS] ========================================\n');
  _log(`[KS] 内容目录: ${contentDir}`);
  _log(`[KS] 文案: ${contentText.length} 字符`);
  _log(`[KS] 图片: ${windowsImages.length} 张`);
  _log(`[KS] 音乐: ${musicQuery}`);

  if (isDryRun) {
    _log('\n[KS] dry-run 模式，跳过 CDP');
    return;
  }

  // Step 0: SCP 图片到 Windows
  const { dateDir, contentDirName } = extractDirNames(contentDir);
  const localImages = findImages(contentDir).slice(0, 8);
  const winDir = path.join(WINDOWS_BASE_DIR, dateDir, contentDirName).replace(/\//g, '\\');
  scpImagesToWindows(localImages, winDir);

  // CDP 连接
  _log('\n[KS] 连接 CDP...');
  const pagesData = await new Promise((resolve, reject) => {
    http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', err => reject(new Error(`CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}`)));
  });

  const ksPage = pagesData.find(p => p.type === 'page' && p.url?.includes(KS_DOMAIN));
  const targetPage = ksPage || pagesData.find(p => p.type === 'page');
  if (!targetPage) throw new Error(`未找到浏览器页面，请在 Chrome (端口 ${CDP_PORT}) 中打开快手创作者中心`);

  const cdp = await createCDP(targetPage.webSocketDebuggerUrl);
  _log('[KS] CDP 已连接\n');

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    // Step 1: 导航到发布页
    _log('[KS] 1. 导航到发布页...');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await cdp.screenshot('01-nav');

    const currentUrl = await cdp.eval_('location.href');
    if (isLoginError(currentUrl)) throw new Error(`快手未登录，请在 Chrome (${CDP_PORT}) 登录创作者中心`);
    _log(`[KS]    URL: ${currentUrl}\n`);

    // Step 2: 点击"上传图文"标签
    _log('[KS] 2. 点击"上传图文"...');
    await cdp.eval_(`(function() {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        if (el.textContent.trim() === '上传图文' && el.offsetParent !== null) { el.click(); return; }
      }
    })()`);
    await sleep(2000);

    // Step 3: 处理草稿弹窗
    const draftResult = await cdp.eval_(`(function() {
      const els = Array.from(document.querySelectorAll('*'));
      for (const txt of ['放弃', '放弃草稿']) {
        const el = els.find(e => e.textContent.trim() === txt && e.offsetParent !== null);
        if (el) { el.click(); return txt; }
      }
      return null;
    })()`);
    if (draftResult) { _log(`[KS]    草稿处理: ${draftResult}`); await sleep(1500); }
    await cdp.screenshot('02-ready');

    // Step 4: 上传图片
    _log('[KS] 3. 上传图片...');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const fcPromise = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('文件选择器超时')), 15000);
      cdp.on('Page.fileChooserOpened', p => { clearTimeout(t); resolve(p); });
    });

    const uploadBtn = await cdp.eval_(`(function() {
      const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && b.textContent.includes('上传图片'));
      if (b) {
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
      return null;
    })()`);

    if (!uploadBtn) throw new Error('未找到上传图片按钮');

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...uploadBtn, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...uploadBtn, button: 'left', clickCount: 1 });

    const fc = await fcPromise;
    await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.backendNodeId, files: windowsImages });
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
    _log(`[KS]    已选择 ${windowsImages.length} 张图片`);

    // 等待上传完成（轮询"作品描述"出现）
    _log('[KS]    等待上传完成...');
    let uploaded = false;
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const has = await cdp.eval_(`document.body.innerHTML.includes('作品描述')`);
      if (has) { _log(`[KS]    上传完成（${i + 1}s）`); uploaded = true; break; }
      if (i % 10 === 0) _log(`[KS]    ... 已等待 ${i}s`);
    }
    if (!uploaded) throw new Error('图片上传超时（90s）');
    await cdp.screenshot('03-uploaded');

    // Step 5: 填写文案
    if (contentText) {
      _log('\n[KS] 4. 填写文案...');
      // 坐标 793, 210 是快手"作品描述" Vue 组件的中心区（已验证）
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 793, y: 210, button: 'left', clickCount: 1 });
      await sleep(100);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 793, y: 210, button: 'left', clickCount: 1 });
      await sleep(400);
      await cdp.send('Input.insertText', { text: contentText });
      await sleep(500);
      const descLen = await cdp.eval_(`(document.activeElement?.value?.length || document.activeElement?.textContent?.length || 0)`);
      _log(`[KS]    文案长度: ${descLen}`);
      await cdp.screenshot('04-desc');
    }

    // Step 6: 选择音乐
    await addMusic(cdp, musicQuery);
    await cdp.screenshot('05-music');

    // Step 7: 点击发布
    _log('\n[KS] 5. 点击发布按钮...');
    const pubBtn = await cdp.eval_(`(function() {
      // TreeWalker 找最后一个可见的"发布"文本节点（跳过"发布图文"等标题）
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node, last = null;
      while (node = walker.nextNode()) {
        if (node.textContent.trim() === '发布') {
          const el = node.parentElement;
          if (el && el.offsetParent !== null) last = el;
        }
      }
      if (last) {
        last.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = last.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
      // fallback: button 元素
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null && b.textContent.trim() === '发布');
      if (btns.length) {
        const b = btns[btns.length - 1];
        b.scrollIntoView({ behavior: 'instant', block: 'center' });
        const r = b.getBoundingClientRect();
        return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
      return { found: false };
    })()`);

    if (!pubBtn?.found) {
      await cdp.screenshot('pub-notfound');
      throw new Error('未找到发布按钮');
    }

    _log(`[KS]    发布按钮坐标: (${pubBtn.x}, ${pubBtn.y})`);
    await sleep(500);
    await cdp.screenshot('06-before-pub');

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pubBtn.x, y: pubBtn.y, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pubBtn.x, y: pubBtn.y, button: 'left', clickCount: 1 });

    _log('[KS]    已点击发布，等待结果...');
    await sleep(5000);
    await cdp.screenshot('07-result');

    // Step 8: 验证结果
    const finalUrl = await cdp.eval_('location.href');
    const toastText = await cdp.eval_(
      `(document.querySelector('[class*="toast"], [class*="message-content"], [class*="notification"]') || {}).textContent?.substring(0, 80)`
    );
    const success = finalUrl?.includes('manage') || finalUrl?.includes('success');

    _log('\n[KS] ========================================');
    _log(`[KS] URL: ${finalUrl}`);
    if (toastText) _log(`[KS] 提示: ${toastText}`);
    _log(`[KS] ${success ? '发布成功' : '仍在发布页（可能审核中）'}`);
    _log('[KS] ========================================\n');

    if (!success && toastText?.includes('失败')) {
      throw new Error(`发布失败: ${toastText}`);
    }

  } finally {
    cdp.close();
  }
}

// ============================================================
// 入口
// ============================================================
(async () => {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const contentIdx = args.indexOf('--content');
  const contentDirArg = contentIdx !== -1 ? args[contentIdx + 1] : null;

  if (!contentDirArg || !fs.existsSync(contentDirArg)) {
    console.error('[KS] 错误：必须提供有效的内容目录路径');
    console.error('[KS] 用法: node publish-kuaishou-image.cjs --content /path/to/image-xxx/');
    process.exit(1);
  }

  const contentDir = path.resolve(contentDirArg);
  const rawContent = readContent(contentDir);
  const contentText = truncateHashtags(rawContent);
  const musicQuery = readMusicQuery(contentDir);

  const localImages = findImages(contentDir).slice(0, 8);
  if (localImages.length === 0) {
    console.error('[KS] 错误：内容目录中未找到图片');
    process.exit(1);
  }
  const { dateDir, contentDirName } = extractDirNames(contentDir);
  const windowsImages = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, dateDir, contentDirName);

  try {
    await main(contentDir, contentText, windowsImages, musicQuery, isDryRun);
  } catch (e) {
    console.error(`\n[KS] 发布失败: ${e.message}`);
    process.exit(1);
  }
})();
