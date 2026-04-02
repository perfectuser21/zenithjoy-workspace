#!/usr/bin/env node
/**
 * 小红书图文发布脚本 v2
 *
 * 方案：CDP UI 自动化（Input.dispatchMouseEvent + Page.fileChooserOpened）
 *   - 修复旧方案：DOM.setFileInputFiles 直接设值无法触发 Vue 上传处理器
 *   - 端口：19224（专用小红书 Chrome 实例）
 *   - SCP：通过 xian-mac 跳板复制图片到 Windows
 *   - 音乐：点击"添加背景音乐" → 搜索 → 选第一个（失败降级跳过）
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-xiaohongshu-image.cjs --content /path/to/image-1/
 *
 * 内容目录结构：
 *   title.txt     - 标题（可选，不超过 20 字）
 *   content.txt   - 正文（可选）
 *   music.txt     - 音乐搜索词（可选，默认搜索热歌）
 *   image.jpg     - 图片（支持 image1.jpg...，最多 9 张）
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

const { CDPClient } = require('../weibo-publisher/cdp-client.cjs');
const {
  findImages,
  readTitle,
  readContent,
  convertToWindowsPaths,
  extractDirNames,
  escapeForJS,
} = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================
const CDP_PORT = 19224;
const WINDOWS_IP = '100.97.242.124';
const WINDOWS_USER = 'xuxia';
const SCREENSHOTS_DIR = '/tmp/xiaohongshu-publish-screenshots';
const WINDOWS_BASE_DIR = 'C:\\Users\\xuxia\\xiaohongshu-media';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
const XHS_DOMAIN = 'creator.xiaohongshu.com';
const DEFAULT_MUSIC_QUERY = '热歌';

// ============================================================
// 纯函数（可导出测试）
// ============================================================

function isLoginError(url) {
  if (!url) return false;
  return url.includes('login') || url.includes('passport');
}

function isPublishSuccess(url, bodyText) {
  const successKeywords = ['发布成功', '笔记已发布', '创作成功'];
  const hasKeyword = successKeywords.some(kw => (bodyText || '').includes(kw));
  const urlChanged = url ? !url.includes('/publish/') : false;
  return hasKeyword || urlChanged;
}

function readMusicQuery(contentDir) {
  const musicFile = path.join(contentDir, 'music.txt');
  if (fs.existsSync(musicFile)) {
    const q = fs.readFileSync(musicFile, 'utf8').trim();
    return q || DEFAULT_MUSIC_QUERY;
  }
  return DEFAULT_MUSIC_QUERY;
}

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    console.log(`[XHS]    截图: ${filepath}`);
    return filepath;
  } catch (e) {
    console.error(`[XHS]    截图失败: ${e.message}`);
    return null;
  }
}

// ============================================================
// SCP：直接从 Mac 复制图片到 Windows
// ============================================================
function scpImagesToWindows(localImages, windowsDir) {
  console.log(`[XHS] 0️⃣  复制图片到 Windows（直连 ${WINDOWS_IP}）...`);

  const winDirForward = windowsDir.replace(/\\/g, '/');
  execSync(
    `ssh -o StrictHostKeyChecking=no ${WINDOWS_USER}@${WINDOWS_IP} "powershell -command \\"New-Item -ItemType Directory -Force -Path '${winDirForward}' | Out-Null; Write-Host ok\\""`,
    { timeout: 20000, stdio: 'pipe' }
  );

  for (const imgPath of localImages) {
    const fname = path.basename(imgPath);
    execSync(
      `scp -o StrictHostKeyChecking=no "${imgPath}" "${WINDOWS_USER}@${WINDOWS_IP}:${winDirForward}/${fname}"`,
      { timeout: 180000, stdio: 'pipe' }
    );
    console.log(`[XHS]    已传输: ${fname}`);
  }

  console.log(`[XHS]    ✅ ${localImages.length} 张图片已复制到 Windows`);
}

// ============================================================
// 音乐选择（失败降级跳过）
// ============================================================
async function addMusic(cdp, musicQuery) {
  console.log(`[XHS] 🎵 选择背景音乐（搜索：${musicQuery}）...`);
  try {
    // 找到"添加背景音乐"或"添加音乐"按钮
    const musicBtnInfo = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          const t = el.textContent.trim();
          if ((t === '添加背景音乐' || t === '添加音乐' || t === '选择音乐') && el.offsetParent !== null) {
            const r = el.getBoundingClientRect();
            return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
          }
        }
        return { found: false };
      })()`,
      returnByValue: true
    });

    if (!musicBtnInfo.result.value?.found) {
      console.log('[XHS]    ⚠️  未找到音乐按钮，跳过音乐选择');
      return;
    }

    const { x, y } = musicBtnInfo.result.value;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(2000);

    // 找搜索输入框并输入
    const searchResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[placeholder*="搜索"], input[placeholder*="音乐"]'));
        const searchInput = inputs.find(i => i.offsetParent !== null);
        if (searchInput) {
          searchInput.focus();
          const r = searchInput.getBoundingClientRect();
          return { found: true, x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
        }
        return { found: false };
      })()`,
      returnByValue: true
    });

    if (!searchResult.result.value?.found) {
      console.log('[XHS]    ⚠️  未找到音乐搜索框，跳过');
      return;
    }

    const { x: sx, y: sy } = searchResult.result.value;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
    await sleep(200);
    await cdp.send('Input.insertText', { text: musicQuery });
    await sleep(300);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(2000);

    // 选第一个结果
    const firstResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const items = Array.from(document.querySelectorAll('[class*="music-item"], [class*="song-item"], [class*="list-item"]'));
        const first = items.find(i => i.offsetParent !== null);
        if (first) {
          first.click();
          return { clicked: true };
        }
        // fallback: 找"使用"按钮
        const useBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '使用' && b.offsetParent !== null);
        if (useBtn) { useBtn.click(); return { clicked: true, via: 'use-btn' }; }
        return { clicked: false };
      })()`,
      returnByValue: true
    });

    if (firstResult.result.value?.clicked) {
      await sleep(1000);
      console.log('[XHS]    ✅ 音乐已选择');
    } else {
      console.log('[XHS]    ⚠️  未找到音乐列表结果，跳过');
    }
  } catch (e) {
    console.warn(`[XHS]    ⚠️  音乐选择失败（降级跳过）: ${e.message}`);
  }
}

// ============================================================
// 主流程
// ============================================================
async function main(contentDir, titleText, contentText, windowsImages, musicQuery, isDryRun) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('\n[XHS] ========================================');
  console.log('[XHS] 小红书图文发布 v2');
  console.log('[XHS] ========================================\n');
  console.log(`[XHS] 内容目录: ${contentDir}`);
  console.log(`[XHS] 标题: ${titleText || '（无）'}`);
  console.log(`[XHS] 正文: ${contentText.length} 字符`);
  console.log(`[XHS] 图片: ${windowsImages.length} 张`);
  console.log(`[XHS] 音乐: ${musicQuery}`);

  if (isDryRun) {
    console.log('\n[XHS] dry-run 模式，跳过 CDP');
    return;
  }

  let cdp;
  try {
    // ===== Step 0: SCP 图片到 Windows =====
    const { dateDir, contentDirName } = extractDirNames(contentDir);
    const localImages = findImages(contentDir).slice(0, 9);
    const winDir = path.join(WINDOWS_BASE_DIR, dateDir, contentDirName).replace(/\//g, '\\');
    scpImagesToWindows(localImages, winDir);

    // ===== CDP 连接 =====
    console.log('\n[XHS] 连接 CDP...');
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', err => reject(new Error(`CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}`)));
    });

    const xhsPage = pagesData.find(p => p.type === 'page' && p.url.includes(XHS_DOMAIN));
    const targetPage = xhsPage || pagesData.find(p => p.type === 'page');
    if (!targetPage) throw new Error(`未找到浏览器页面，请在 Chrome (端口 ${CDP_PORT}) 中打开 ${PUBLISH_URL}`);

    cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    console.log('[XHS] ✅ CDP 已连接\n');

    // ===== Step 1: 导航到发布页 =====
    console.log('[XHS] 1️⃣  导航到发布页...');
    await cdp.send('Page.navigate', { url: PUBLISH_URL });
    await sleep(5000);
    await screenshot(cdp, '01-nav');

    const urlRes = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const currentUrl = urlRes.result.value;
    if (isLoginError(currentUrl)) throw new Error(`小红书未登录，请在 Chrome (${CDP_PORT}) 登录`);
    console.log(`[XHS]    URL: ${currentUrl}\n`);

    // ===== Step 2: 选择图文类型 =====
    console.log('[XHS] 2️⃣  选择图文模式...');
    await sleep(2000);
    await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const all = Array.from(document.querySelectorAll('*'));
        // 尝试 '图文' 或 '上传图文'，优先找叶子节点，fallback 找包含文本的元素
        for (const text of ['图文', '上传图文']) {
          const el = all.find(e => e.textContent.trim() === text && e.offsetParent !== null && e.children.length === 0);
          if (el) { el.click(); return text; }
        }
        // 二次 fallback：用坐标点击可见的 '上传图文' tab
        const tabs = all.filter(e => e.textContent.trim() === '上传图文' && e.offsetParent !== null);
        const tab = tabs.find(t => { const r = t.getBoundingClientRect(); return r.x > 0 && r.y > 0; });
        if (tab) { tab.click(); return '上传图文(fallback)'; }
        return 'not found';
      })()`,
      returnByValue: true
    });
    await sleep(2000);

    // ===== Step 3: 上传图片（Input.dispatchMouseEvent + Page.fileChooserOpened）=====
    console.log(`[XHS] 3️⃣  上传图片（${windowsImages.length} 张）...`);

    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const fcPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('File chooser timeout 12s')), 12000);
      cdp.on('Page.fileChooserOpened', params => {
        clearTimeout(timer);
        resolve(params);
      });
    });

    // 找上传按钮坐标
    const uploadBtnInfo = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const btns = Array.from(document.querySelectorAll('button, label, div'));
        for (const text of ['上传图片', '上传图文', '点击上传', '选择文件']) {
          const b = btns.find(el => el.textContent.trim() === text && el.offsetParent !== null);
          if (b) { const r = b.getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), text }; }
        }
        // fallback: 找可见的 file input 的父元素
        const inp = document.querySelector('input[type="file"]');
        if (inp) {
          const parent = inp.closest('label') || inp.closest('div') || inp.parentElement;
          if (parent && parent.offsetParent) {
            const r = parent.getBoundingClientRect();
            return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), text: 'fallback-parent' };
          }
        }
        return null;
      })()`,
      returnByValue: true
    });

    if (!uploadBtnInfo.result.value) {
      await screenshot(cdp, '03-no-upload-btn');
      throw new Error('未找到上传按钮');
    }

    const { x: ux, y: uy } = uploadBtnInfo.result.value;
    console.log(`[XHS]    上传按钮坐标: (${ux}, ${uy})`);

    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ux, y: uy, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ux, y: uy, button: 'left', clickCount: 1 });

    const fc = await fcPromise;
    console.log(`[XHS]    文件选择器 backendNodeId: ${fc.backendNodeId}`);

    await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.backendNodeId, files: windowsImages });
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });

    console.log('[XHS]    等待上传完成...');
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const body = document.body.innerHTML;
          return body.includes('发布笔记') || body.includes('发布图文') || body.includes('写点什么') || body.includes('添加标题');
        })()`,
        returnByValue: true
      });
      if (r.result.value) { console.log(`[XHS]    上传完成（${i}s）`); break; }
      if (i % 10 === 0 && i > 0) console.log(`[XHS]    ... ${i}s`);
    }
    await screenshot(cdp, '03-uploaded');

    // ===== Step 4: 填写标题 =====
    if (titleText) {
      console.log(`[XHS] 4️⃣  填写标题...`);
      const escapedTitle = escapeForJS(titleText);
      await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const sels = ['input[placeholder*="标题"]', 'input[placeholder*="填写标题"]', 'input[class*="title"]', 'input[maxlength="20"]', 'input[maxlength="50"]'];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.offsetParent) {
              el.focus();
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(el, '${escapedTitle}');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return true;
            }
          }
          return false;
        })()`,
        returnByValue: true
      });
      await sleep(500);
    }

    // ===== Step 5: 填写正文（Input.insertText）=====
    if (contentText) {
      console.log(`[XHS] 5️⃣  填写正文（${contentText.length} 字符）...`);
      // 先找正文区坐标并点击
      const contentAreaInfo = await cdp.send('Runtime.evaluate', {
        expression: `(function() {
          const sels = [
            'div[contenteditable="true"][class*="content"]',
            'div[contenteditable="true"][class*="desc"]',
            'div[contenteditable="true"][class*="editor"]',
            '.ql-editor',
            'div[contenteditable="true"]',
            'textarea'
          ];
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el && el.offsetParent) {
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2), sel: s };
            }
          }
          return null;
        })()`,
        returnByValue: true
      });

      if (contentAreaInfo.result.value) {
        const { x: cx, y: cy } = contentAreaInfo.result.value;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
        await sleep(200);
        await cdp.send('Input.insertText', { text: contentText });
        await sleep(500);
        console.log('[XHS]    正文已填写');
      } else {
        console.warn('[XHS]    ⚠️  未找到正文区域');
      }
      await screenshot(cdp, '05-content');
    }

    // ===== Step 6: 选择背景音乐 =====
    await addMusic(cdp, musicQuery);

    // ===== Step 7: 点击发布 =====
    console.log('[XHS] 7️⃣  点击发布...');
    await sleep(1000);
    await screenshot(cdp, '07-before-pub');

    const publishRes = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node, last = null;
        while (node = walker.nextNode()) {
          if (node.textContent.trim() === '发布') {
            const el = node.parentElement;
            if (el.offsetParent !== null && !el.hasAttribute('disabled')) last = el;
          }
        }
        if (last) {
          last.scrollIntoView({ behavior: 'instant', block: 'center' });
          const r = last.getBoundingClientRect();
          return { found: true, x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) };
        }
        return { found: false };
      })()`,
      returnByValue: true
    });

    if (!publishRes.result.value?.found) {
      await screenshot(cdp, '07-no-pub-btn');
      throw new Error('未找到发布按钮');
    }

    const { x: px, y: py } = publishRes.result.value;
    await sleep(300);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(100);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(5000);
    await screenshot(cdp, '07-after-pub');

    // ===== Step 8: 验证结果 =====
    const finalUrlRes = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const finalUrl = finalUrlRes.result.value;
    const bodyRes = await cdp.send('Runtime.evaluate', { expression: 'document.body.textContent.slice(0,500)', returnByValue: true });
    const bodyText = bodyRes.result.value;

    if (isPublishSuccess(finalUrl, bodyText)) {
      console.log('\n[XHS] ✅ 发布成功！');
      console.log(`[XHS]    最终 URL: ${finalUrl}`);
    } else {
      console.log('\n[XHS] ⚠️  发布状态不确定，请查看截图');
    }
    console.log(`[XHS]    截图目录: ${SCREENSHOTS_DIR}`);

  } catch (err) {
    console.error(`\n[XHS] ❌ 发布失败: ${err.message}`);
    if (cdp) await screenshot(cdp, 'error').catch(() => {});
    process.exit(1);
  } finally {
    if (cdp) cdp.close();
  }
}

// ============================================================
// CLI 入口
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('用法：node publish-xiaohongshu-image.cjs --content /path/to/image-xxx/');
    console.log('选项：');
    console.log('  --content <dir>   内容目录（必须包含图片）');
    console.log('  --dry-run         仅打印参数，不连接 CDP');
    process.exit(0);
  }

  const isDryRun = args.includes('--dry-run');
  const contentIdx = args.indexOf('--content');
  if (contentIdx < 0 || !args[contentIdx + 1]) {
    console.error('❌ 必须提供 --content 参数');
    process.exit(1);
  }

  const contentDir = path.resolve(args[contentIdx + 1]);
  if (!fs.existsSync(contentDir)) {
    console.error(`❌ 目录不存在: ${contentDir}`);
    process.exit(1);
  }

  const localImages = findImages(contentDir).slice(0, 9);
  if (localImages.length === 0) {
    console.error('❌ 内容目录中没有图片');
    process.exit(1);
  }

  const contentText = readContent(contentDir);
  const rawTitle = readTitle(contentDir);
  const titleText = rawTitle || contentText.replace(/#[^#\s]+/g, '').trim().slice(0, 20);
  const musicQuery = readMusicQuery(contentDir);

  const { dateDir, contentDirName } = extractDirNames(contentDir);
  const windowsImages = convertToWindowsPaths(localImages, WINDOWS_BASE_DIR, dateDir, contentDirName);

  main(contentDir, titleText, contentText, windowsImages, musicQuery, isDryRun).catch(err => {
    console.error(`\n[XHS] ❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { isLoginError, isPublishSuccess, readMusicQuery };
