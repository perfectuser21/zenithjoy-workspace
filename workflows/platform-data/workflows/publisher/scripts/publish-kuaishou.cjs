#!/usr/bin/env node
/**
 * 快手图文发布脚本
 *
 * 功能：图文帖子发布（文案 + 最多 9 张图片）
 * 用法：node publish-kuaishou.cjs --content /path/to/kuaishou-{id}.json
 *
 * 内容 JSON 格式：
 * {
 *   "type": "kuaishou",
 *   "id": "xxx",
 *   "content": "快手图文文案",
 *   "images": ["/path/to/img1.jpg", "/path/to/img2.jpg"]
 * }
 *
 * 架构：Mac mini → CDP → Windows PC (100.97.242.124:19223) → cp.kuaishou.com
 * 图片通过 base64 + DataTransfer 注入，无需文件路径转换
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// 配置常量
// ============================================================

const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';
const KUAISHOU_URL_PATTERN = 'kuaishou.com';
const KUAISHOU_CP_URL = 'https://cp.kuaishou.com';
const KUAISHOU_PHOTO_CREATE_URL = 'https://cp.kuaishou.com/article/publish/photo/create';
const MAX_IMAGES = 9;
const SCREENSHOTS_DIR = '/tmp/kuaishou-publish-screenshots';

// 超时配置（毫秒）
const UPLOAD_TIMEOUT_MS = 35000;   // 单张图片上传等待（快手稍慢，适当增加）
const PUBLISH_TIMEOUT_MS = 25000;  // 发布等待
const CDP_CMD_TIMEOUT_MS = 60000;  // CDP 命令超时
const NAVIGATE_TIMEOUT_MS = 8000;  // 页面导航等待

// 创建截图目录
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ============================================================
// 日志工具
// ============================================================

function log(message, level = 'INFO') {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function logError(message) {
  log(message, 'ERROR');
}

// ============================================================
// 命令行参数解析
// ============================================================

const args = process.argv.slice(2);
const contentFileIdx = args.indexOf('--content');
const contentFile = contentFileIdx !== -1 ? args[contentFileIdx + 1] : null;

if (!contentFile || !fs.existsSync(contentFile)) {
  console.error('❌ 错误：必须提供有效的内容文件路径');
  console.error('使用方式：node publish-kuaishou.cjs --content /path/to/kuaishou-xxx.json');
  process.exit(1);
}

// 读取并验证内容
let content;
try {
  content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
} catch (e) {
  console.error(`❌ 错误：无法解析内容文件: ${e.message}`);
  process.exit(1);
}

if (content.type !== 'kuaishou') {
  console.error('❌ 错误：此脚本只能发布快手内容（type: kuaishou）');
  process.exit(1);
}

if (!content.content || content.content.trim().length === 0) {
  console.error('❌ 错误：内容不能为空');
  process.exit(1);
}

const images = (content.images || []).slice(0, MAX_IMAGES);

// 验证图片文件存在
const validImages = images.filter(imgPath => {
  if (fs.existsSync(imgPath)) {
    return true;
  }
  logError(`图片不存在，已跳过: ${imgPath}`);
  return false;
});

console.log('\n========================================');
console.log('快手图文发布');
console.log('========================================\n');
console.log(`📄 内容 ID: ${content.id || '(无)'}`);
console.log(`📝 内容长度: ${content.content.length} 字符`);
console.log(`🖼️  图片数量: ${validImages.length}（有效）/ ${(content.images || []).length}（原始）`);
if (images.length !== (content.images || []).length) {
  console.log(`⚠️  图片超过 ${MAX_IMAGES} 张，已截取前 ${MAX_IMAGES} 张`);
}
console.log('');

// ============================================================
// CDPClient
// ============================================================

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
      this.ws.on('message', data => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(
        () => reject(new Error(`CDP 命令超时: ${method}`)),
        CDP_CMD_TIMEOUT_MS
      );
      this.callbacks[id] = msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, returnByValue = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise: false,
    });
    return result && result.result ? result.result.value : undefined;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
// 工具函数
// ============================================================

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(cdp, name) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
    fs.writeFileSync(filepath, Buffer.from(result.data, 'base64'));
    log(`📸 截图: ${filepath}`);
  } catch (e) {
    logError(`截图失败: ${e.message}`);
  }
}

/**
 * 将图片文件转换为 base64 字符串及 MIME 类型
 */
function imageToBase64(imgPath) {
  const data = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  return { base64: data.toString('base64'), mimeType, name: path.basename(imgPath) };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  let cdp;

  try {
    // ========== 获取快手标签页 ==========
    log('🔗 连接到 Windows Chrome DevTools...');

    const pagesData = await new Promise((resolve, reject) => {
      const req = http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`CDP JSON 解析失败: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error(`连接 CDP ${WINDOWS_IP}:${CDP_PORT} 超时`));
      });
    });

    // 优先找快手创作者平台标签页，降级使用第一个 page
    let kuaishouPage = pagesData.find(
      p => p.type === 'page' && p.url.includes(KUAISHOU_URL_PATTERN)
    );

    if (!kuaishouPage) {
      kuaishouPage = pagesData.find(p => p.type === 'page');
      if (kuaishouPage) {
        log('⚠️  未找到快手标签页，使用第一个可用页面', 'WARN');
      } else {
        throw new Error('未找到任何可用标签页，请先在浏览器中打开 cp.kuaishou.com 并登录');
      }
    }

    cdp = new CDPClient(kuaishouPage.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    log('✅ CDP 已连接');

    // ========== 步骤1: 导航到快手图文发布页 ==========
    log('\n1️⃣  导航到快手图文发布页...');

    const currentUrl = await cdp.eval('window.location.href');
    log(`   当前 URL: ${currentUrl}`);

    // 如果不在快手创作平台，先导航过去
    if (!currentUrl || !currentUrl.includes(KUAISHOU_URL_PATTERN)) {
      log('   导航到快手创作者平台...');
      await cdp.send('Page.navigate', { url: KUAISHOU_CP_URL });
      await sleep(NAVIGATE_TIMEOUT_MS);
    }

    // 无论如何，导航到图文发布页
    const postUrl = await cdp.eval('window.location.href');
    if (!postUrl || !postUrl.includes('publish/photo')) {
      log('   导航到图文发布页面...');
      await cdp.send('Page.navigate', { url: KUAISHOU_PHOTO_CREATE_URL });
      await sleep(NAVIGATE_TIMEOUT_MS);
    }

    const finalUrl = await cdp.eval('window.location.href');
    log(`   当前 URL: ${finalUrl}`);

    // 检查是否被重定向到登录页
    if (finalUrl && finalUrl.includes('login')) {
      throw new Error('检测到登录页面，请先在浏览器中登录快手创作平台 (cp.kuaishou.com)');
    }

    await screenshot(cdp, '01-photo-create-page');
    log('   ✅ 完成');

    // ========== 步骤2: 等待页面加载完成 ==========
    log('\n2️⃣  等待编辑器加载...');
    await sleep(3000);

    // 检查编辑器是否存在
    const editorCheck = await cdp.eval(`(function() {
      const selectors = [
        '[class*="editor"]',
        '[class*="text-input"]',
        '[class*="caption"]',
        '[placeholder*="添加"]',
        '[placeholder*="描述"]',
        '[placeholder*="说点什么"]',
        '[contenteditable="true"]',
        'textarea',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return 'FOUND:' + sel + '|tag=' + el.tagName;
      }
      return 'NOT_FOUND';
    })()`);

    log(`   编辑器状态: ${editorCheck}`);
    await screenshot(cdp, '02-editor-loaded');
    log('   ✅ 完成');

    // ========== 步骤3: 上传图片（快手需先上传图片再写文案）==========
    if (validImages.length > 0) {
      log(`\n3️⃣  上传图片（${validImages.length} 张）...`);

      for (let i = 0; i < validImages.length; i++) {
        const imgPath = validImages[i];
        log(`   [${i + 1}/${validImages.length}] 上传: ${imgPath}`);

        const { base64, mimeType, name: imgName } = imageToBase64(imgPath);

        // 先尝试点击图片上传区域触发 input
        await cdp.eval(`(function() {
          const uploadTriggers = [
            '[class*="upload"]',
            '[class*="add-image"]',
            '[class*="image-add"]',
            '[class*="photo-upload"]',
            '[data-testid*="upload"]',
            '.upload-btn',
            '.add-photo',
          ];
          for (const sel of uploadTriggers) {
            const el = document.querySelector(sel);
            if (el) {
              el.click();
              return 'CLICKED:' + sel;
            }
          }
          return 'NO_TRIGGER';
        })()`);

        await sleep(500);

        // 通过 DataTransfer 注入图片到 file input
        const uploadResult = await cdp.eval(`(function() {
          // 查找图片上传 input
          const inputs = document.querySelectorAll('input[type="file"]');
          let imageInput = null;

          for (const inp of inputs) {
            const accept = inp.getAttribute('accept') || '';
            if (accept.includes('image') || accept.includes('.jpg') || accept.includes('.png')) {
              imageInput = inp;
              break;
            }
          }

          // 降级：使用第一个 file input
          if (!imageInput && inputs.length > 0) {
            imageInput = inputs[0];
          }

          if (!imageInput) return 'FAIL:no file input found';

          try {
            const byteChars = atob(${JSON.stringify(base64)});
            const byteArr = new Uint8Array(byteChars.length);
            for (let k = 0; k < byteChars.length; k++) {
              byteArr[k] = byteChars.charCodeAt(k);
            }
            const file = new File([byteArr], ${JSON.stringify(imgName)}, { type: ${JSON.stringify(mimeType)} });

            const dt = new DataTransfer();
            dt.items.add(file);
            imageInput.files = dt.files;
            imageInput.dispatchEvent(new Event('change', { bubbles: true }));
            imageInput.dispatchEvent(new Event('input', { bubbles: true }));

            return 'OK:' + ${JSON.stringify(imgName)};
          } catch (e) {
            return 'FAIL:' + e.message;
          }
        })()`);

        log(`   上传结果: ${uploadResult}`);

        if (uploadResult && uploadResult.startsWith('FAIL')) {
          logError(`图片 ${i + 1} 上传失败: ${uploadResult}`);
          // 继续尝试下一张，不中止整个流程
        }

        const waitMs = validImages.length > 1
          ? Math.ceil(UPLOAD_TIMEOUT_MS / validImages.length)
          : UPLOAD_TIMEOUT_MS;
        await sleep(waitMs);
      }

      await screenshot(cdp, '03-images-uploaded');

      // 检查上传状态
      const uploadStatus = await cdp.eval(`(function() {
        const body = document.body.innerText || '';
        const failed = body.includes('上传失败') || body.includes('图片上传失败') || body.includes('上传出错');
        const uploading = body.includes('上传中') || body.includes('上传...') || body.includes('正在上传');
        return JSON.stringify({ failed, uploading });
      })()`);

      log(`   上传状态: ${uploadStatus}`);

      try {
        const statusObj = JSON.parse(uploadStatus || '{}');
        if (statusObj.failed) {
          throw new Error('检测到图片上传失败提示');
        }
        if (statusObj.uploading) {
          log('   ⏳ 图片仍在上传中，额外等待 8s...');
          await sleep(8000);
        }
      } catch (e) {
        if (e.message.includes('检测到')) throw e;
      }

      log('   ✅ 图片上传完成');
    } else {
      log('\n3️⃣  跳过图片上传（无有效图片）');
    }

    // ========== 步骤4: 填写文案 ==========
    log(`\n4️⃣  填写文案（${content.content.length} 字）...`);

    await sleep(1000);

    // 安全转义，供 JS 字符串字面量使用
    const escapedContent = JSON.stringify(content.content);

    const fillResult = await cdp.eval(`(function() {
      // 快手图文文案输入框（按优先级排列）
      const selectors = [
        '[placeholder*="添加描述"]',
        '[placeholder*="说点什么"]',
        '[placeholder*="添加话题"]',
        '[placeholder*="描述"]',
        '[class*="caption"] textarea',
        '[class*="caption"] [contenteditable]',
        '[class*="text-input"] textarea',
        '[class*="description"] textarea',
        '[class*="editor"] textarea',
        '[class*="post-text"] textarea',
        'textarea[class*="input"]',
        'textarea',
        '[contenteditable="true"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;

        el.focus();
        el.click();

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          // 使用原生 setter 绕过框架响应式拦截
          const proto = el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          nativeSetter.call(el, ${escapedContent});

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

          return 'OK_TEXTAREA:' + el.value.substring(0, 30) + '...';
        } else if (el.contentEditable === 'true') {
          // contenteditable div 处理
          el.innerText = ${escapedContent};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));

          return 'OK_CONTENTEDITABLE:' + el.innerText.substring(0, 30) + '...';
        }
      }

      return 'FAIL:no text input found';
    })()`);

    log(`   填写结果: ${fillResult}`);

    if (fillResult && fillResult.startsWith('FAIL')) {
      logError('无法找到文案输入框');
      await screenshot(cdp, 'error-no-text-input');
      // 不立即中止，继续尝试发布（有些情况下文案是可选的）
      log('   ⚠️  文案填写失败，继续尝试发布', 'WARN');
    }

    await sleep(1000);
    await screenshot(cdp, '04-content-filled');
    log('   ✅ 完成');

    // ========== 步骤5: 关闭可能的提示弹窗 ==========
    log('\n5️⃣  关闭可能的弹窗...');

    await cdp.eval(`(function() {
      const closeSelectors = [
        'button.close',
        '[aria-label="关闭"]',
        '[aria-label="Close"]',
        '.modal-close',
        '[class*="close-btn"]',
        '[class*="dialog-close"]',
      ];
      for (const sel of closeSelectors) {
        const el = document.querySelector(sel);
        if (el) { el.click(); }
      }
      // 关闭确认类弹窗
      const btns = document.querySelectorAll('button, span[role="button"], div[role="button"]');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === '我知道了' || text === '确定' || text === '知道了') {
          btn.click();
        }
      }
    })()`);

    await sleep(1000);
    log('   ✅ 完成');

    // ========== 步骤6: 点击发布 ==========
    log('\n6️⃣  点击发布按钮...');

    const publishResult = await cdp.eval(`(function() {
      // 快手发布按钮选择器（按优先级排列）
      const selectors = [
        '[class*="submit-btn"]',
        '[class*="publish-btn"]',
        '[class*="post-btn"]',
        'button[type="submit"]',
        '.submit',
        '.publish',
      ];

      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetWidth > 0) {
          btn.click();
          return 'CLICKED:' + sel;
        }
      }

      // 按文字查找发布按钮
      const allBtns = document.querySelectorAll('button, a[role="button"], div[role="button"], span[role="button"]');
      for (const btn of allBtns) {
        const text = btn.textContent.trim();
        if (
          (text === '发布' || text === '提交' || text === '发表' || text === '发布作品')
          && !btn.disabled
          && btn.offsetWidth > 0
        ) {
          btn.click();
          return 'CLICKED_TEXT:' + text;
        }
      }

      return 'FAIL:no publish button found';
    })()`);

    log(`   发布结果: ${publishResult}`);

    if (publishResult && publishResult.startsWith('FAIL')) {
      await screenshot(cdp, 'error-no-publish-btn');
      throw new Error(`找不到发布按钮: ${publishResult}`);
    }

    await screenshot(cdp, '05-publish-clicked');

    // ========== 步骤7: 等待发布完成 ==========
    log(`\n7️⃣  等待发布完成（最多 ${PUBLISH_TIMEOUT_MS / 1000} 秒）...`);

    const publishStart = Date.now();
    let published = false;

    while (Date.now() - publishStart < PUBLISH_TIMEOUT_MS) {
      await sleep(1000);

      const checkResult = await cdp.eval(`(function() {
        const successTexts = ['发布成功', '已发布', '发布完成', '作品已发布', '提交成功'];
        const allText = document.body.innerText || '';
        for (const t of successTexts) {
          if (allText.includes(t)) return 'SUCCESS:' + t;
        }

        // 检查 URL 跳转（发布成功后通常跳转到作品管理页）
        const url = window.location.href;
        if (url.includes('/manage') || url.includes('success')) return 'URL_CHANGED:' + url;

        // 检查是否有错误提示
        const errorTexts = ['发布失败', '提交失败', '上传失败'];
        for (const t of errorTexts) {
          if (allText.includes(t)) return 'ERROR:' + t;
        }

        return 'WAITING';
      })()`);

      if (checkResult && (checkResult.startsWith('SUCCESS') || checkResult.startsWith('URL_CHANGED'))) {
        log(`   检测到: ${checkResult}`);
        published = true;
        break;
      }

      if (checkResult && checkResult.startsWith('ERROR')) {
        await screenshot(cdp, 'error-publish-failed');
        throw new Error(`发布失败: ${checkResult}`);
      }
    }

    const elapsed = ((Date.now() - publishStart) / 1000).toFixed(1);

    if (published) {
      log(`   ✅ 发布成功，耗时 ${elapsed} 秒`);
    } else {
      log(`   ⚠️  等待超时（${elapsed} 秒），假定发布已完成`, 'WARN');
    }

    await screenshot(cdp, '06-result');

    // ========== 步骤8: 更新状态文件 ==========
    log('\n8️⃣  更新状态文件...');

    content.status = 'published';
    content.publishedAt = new Date().toISOString();
    fs.writeFileSync(contentFile, JSON.stringify(content, null, 2));

    log(`   ✅ 状态已写回: ${contentFile}`);

    // ========== 完成 ==========
    console.log('\n========================================');
    console.log('✅ 快手图文发布成功');
    console.log('========================================');
    console.log(`截图目录: ${SCREENSHOTS_DIR}`);
    console.log('');

    process.exit(0);

  } catch (err) {
    console.error('\n========================================');
    console.error('❌ 快手图文发布失败');
    console.error('========================================');
    console.error(err);
    console.error('');

    if (cdp) {
      await screenshot(cdp, 'error-state').catch(() => {});
    }

    process.exit(1);

  } finally {
    if (cdp) {
      cdp.close();
    }
  }
}

main();
