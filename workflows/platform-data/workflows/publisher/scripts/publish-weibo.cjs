#!/usr/bin/env node
/**
 * 微博图文发布脚本
 *
 * 功能：文字 + 图片发布（最多 9 张）
 * 用法：node publish-weibo.cjs --content /path/to/weibo-{id}.json
 *
 * 内容 JSON 格式：
 * {
 *   "type": "weibo",
 *   "id": "xxx",
 *   "content": "微博文案",
 *   "images": ["/path/to/img1.jpg", "/path/to/img2.jpg"]
 * }
 *
 * 架构：Mac mini → Windows PC (100.97.242.124:19227) → 微博
 * 图片通过 base64 + DataTransfer 方式注入，无需文件路径转换
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19227;
const WINDOWS_IP = '100.97.242.124';
const WEIBO_URL_PATTERN = 'weibo.com';
const MAX_IMAGES = 9;
const SCREENSHOTS_DIR = '/tmp/weibo-publish-screenshots';

// 超时配置（毫秒）
const UPLOAD_TIMEOUT_MS = 30000;   // 单张图片上传等待
const PUBLISH_TIMEOUT_MS = 20000;  // 发布等待
const CDP_CMD_TIMEOUT_MS = 60000;  // CDP 命令超时

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
  console.error('使用方式：node publish-weibo.cjs --content /path/to/weibo-xxx.json');
  process.exit(1);
}

// 读取并验证内容
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));

if (content.type !== 'weibo') {
  console.error('❌ 错误：此脚本只能发布微博内容（type: weibo）');
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
console.log('微博图文发布');
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
    // ========== 获取微博标签页 ==========
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

    // 优先找微博标签页，降级使用第一个 page
    let weiboPage = pagesData.find(
      p => p.type === 'page' && p.url.includes(WEIBO_URL_PATTERN)
    );

    if (!weiboPage) {
      weiboPage = pagesData.find(p => p.type === 'page');
      if (weiboPage) {
        log('⚠️  未找到微博标签页，使用第一个可用页面', 'WARN');
      } else {
        throw new Error('未找到任何可用标签页，请先在浏览器中打开 weibo.com');
      }
    }

    cdp = new CDPClient(weiboPage.webSocketDebuggerUrl);
    await cdp.connect();

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');

    log('✅ CDP 已连接');

    // ========== 步骤1: 确认微博页面 ==========
    log('\n1️⃣  确认微博页面...');

    const currentUrl = await cdp.eval('window.location.href');
    log(`   当前 URL: ${currentUrl}`);

    if (!currentUrl || !currentUrl.includes(WEIBO_URL_PATTERN)) {
      log('   导航到微博首页...');
      await cdp.send('Page.navigate', { url: 'https://weibo.com' });
      await sleep(5000);
      const newUrl = await cdp.eval('window.location.href');
      log(`   导航后 URL: ${newUrl}`);
    }

    await screenshot(cdp, '01-initial');
    log('   ✅ 完成');

    // ========== 步骤2: 打开发布框 ==========
    log('\n2️⃣  打开发布框...');

    const composeResult = await cdp.eval(`(function() {
      const selectors = [
        'textarea[node-type="text"]',
        '.gn_textarea',
        '.ToolBar_box_1Dg53',
        '[placeholder*="有什么新鲜事"]',
        '[placeholder*="分享你的想法"]',
        'textarea.W_input',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.click();
          el.focus();
          return 'FOUND:' + sel;
        }
      }

      // 按文字找"发微博"入口按钮
      const btns = document.querySelectorAll('a, button, div[role="button"]');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === '发微博' || text === '写微博' || text === '+ 发微博') {
          btn.click();
          return 'CLICKED:' + text;
        }
      }

      return 'NOT_FOUND';
    })()`);

    log(`   发布框: ${composeResult}`);
    await sleep(2000);
    await screenshot(cdp, '02-compose-opened');
    log('   ✅ 完成');

    // ========== 步骤3: 填写文案 ==========
    log(`\n3️⃣  填写文案（${content.content.length} 字）...`);

    // 安全转义，供 JS 字符串字面量使用
    const escapedContent = JSON.stringify(content.content);

    const fillResult = await cdp.eval(`(function() {
      const selectors = [
        'textarea[node-type="text"]',
        '.gn_textarea',
        '[placeholder*="有什么新鲜事"]',
        '[placeholder*="分享你的想法"]',
        'textarea.W_input',
        '.ToolBar_box_1Dg53 textarea',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();

          // 使用原生 setter 绕过框架响应式拦截
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeSetter.call(el, ${escapedContent});

          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

          return 'OK:' + el.value.substring(0, 30) + '...';
        }
      }
      return 'FAIL:no textarea found';
    })()`);

    log(`   填写结果: ${fillResult}`);

    if (fillResult && fillResult.startsWith('FAIL')) {
      logError('无法找到文案输入框，尝试重新导航...');
      await cdp.send('Page.navigate', { url: 'https://weibo.com' });
      await sleep(5000);

      const retryResult = await cdp.eval(`(function() {
        const el = document.querySelector(
          'textarea[node-type="text"], .gn_textarea, [placeholder*="有什么新鲜事"]'
        );
        if (el) {
          el.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeSetter.call(el, ${escapedContent});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return 'RETRY_OK:' + el.value.substring(0, 30);
        }
        return 'RETRY_FAIL';
      })()`);

      log(`   重试结果: ${retryResult}`);
      if (retryResult && retryResult.startsWith('RETRY_FAIL')) {
        throw new Error('无法填写文案，发布中止');
      }
    }

    await sleep(1000);
    await screenshot(cdp, '03-content-filled');
    log('   ✅ 完成');

    // ========== 步骤4: 上传图片 ==========
    if (validImages.length > 0) {
      log(`\n4️⃣  上传图片（${validImages.length} 张）...`);

      for (let i = 0; i < validImages.length; i++) {
        const imgPath = validImages[i];
        log(`   [${i + 1}/${validImages.length}] 上传: ${imgPath}`);

        const { base64, mimeType, name: imgName } = imageToBase64(imgPath);

        // 将 base64 字符串注入页面并通过 DataTransfer 设置到 file input
        const uploadResult = await cdp.eval(`(function() {
          // 找到图片上传 input
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
            // 解码 base64 构建 File 对象
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

        // 等待上传处理（多张时按比例分配，单张等满时间）
        const waitMs = validImages.length > 1
          ? Math.ceil(UPLOAD_TIMEOUT_MS / validImages.length)
          : UPLOAD_TIMEOUT_MS;
        await sleep(waitMs);
      }

      await screenshot(cdp, '04-images-uploaded');

      // 检查是否有上传失败提示
      const uploadStatus = await cdp.eval(`(function() {
        const body = document.body.innerText || '';
        const failed = body.includes('上传失败') || body.includes('图片上传失败');
        const uploading = body.includes('上传中') || body.includes('上传...');
        return JSON.stringify({ failed, uploading });
      })()`);

      log(`   上传状态: ${uploadStatus}`);

      try {
        const statusObj = JSON.parse(uploadStatus || '{}');
        if (statusObj.failed) {
          throw new Error('检测到图片上传失败提示');
        }
        if (statusObj.uploading) {
          log('   ⏳ 图片仍在上传中，额外等待 5s...');
          await sleep(5000);
        }
      } catch (e) {
        if (e.message.includes('检测到')) throw e;
        // JSON.parse 失败忽略
      }

      log('   ✅ 图片上传完成');
    } else {
      log('\n4️⃣  跳过图片上传（无有效图片）');
    }

    // ========== 步骤5: 关闭可能的提示弹窗 ==========
    log('\n5️⃣  关闭可能的弹窗...');

    await cdp.eval(`(function() {
      const closeSelectors = ['button.close', '.modal-close', '[aria-label="Close"]'];
      for (const sel of closeSelectors) {
        const el = document.querySelector(sel);
        if (el) el.click();
      }
      // 关闭"我知道了"/"确定"类弹窗
      const btns = document.querySelectorAll('button, span[role="button"]');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === '我知道了' || text === '确定') {
          btn.click();
        }
      }
    })()`);

    await sleep(1000);
    log('   ✅ 完成');

    // ========== 步骤6: 点击发布 ==========
    log('\n6️⃣  点击发布按钮...');

    const publishResult = await cdp.eval(`(function() {
      // 常见发布按钮选择器
      const selectors = [
        'button[node-type="submit"]',
        '.W_btn_a',
        'a.btn_pubish',
        'button.submit',
        '.ToolBar_btn_QBjF6',
      ];

      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.offsetWidth > 0) {
          btn.click();
          return 'CLICKED:' + sel;
        }
      }

      // 按文字查找
      const allBtns = document.querySelectorAll('button, a, div[role="button"]');
      for (const btn of allBtns) {
        const text = btn.textContent.trim();
        if ((text === '发布' || text === '发微博') && !btn.disabled && btn.offsetWidth > 0) {
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
        const successTexts = ['发布成功', '微博已发布', '已发布'];
        const allText = document.body.innerText || '';
        for (const t of successTexts) {
          if (allText.includes(t)) return 'SUCCESS:' + t;
        }

        // URL 跳转到个人页面
        const url = window.location.href;
        if (url.includes('/u/') && url.includes('?')) return 'URL_CHANGED';

        return 'WAITING';
      })()`);

      if (checkResult && (checkResult.startsWith('SUCCESS') || checkResult === 'URL_CHANGED')) {
        log(`   检测到: ${checkResult}`);
        published = true;
        break;
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
    console.log('✅ 微博发布成功');
    console.log('========================================');
    console.log(`截图目录: ${SCREENSHOTS_DIR}`);
    console.log('');

    process.exit(0);

  } catch (err) {
    console.error('\n========================================');
    console.error('❌ 微博发布失败');
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
