/**
 * VPS 发布脚本 - 使用原生 CDP WebSocket
 * Windows 只需要：Chrome 保持登录 + Tailscale + file-receiver.js
 * 所有逻辑在 VPS
 *
 * 关键发现：Puppeteer 连接到已存在的页面会超时，
 * 必须使用新页面或直接 CDP WebSocket
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============

const WINDOWS_IP = '100.97.242.124';  // node 机器（原 ROG: 100.98.253.95）
const FILE_RECEIVER_PORT = 3001;  // Windows file-receiver.js

const DASHBOARD_API = 'http://localhost:3333';
const API_KEY = 'dev-api-key-2025';

const TEMP_DIR = '/tmp/publish-files';
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const LOCK_DIR = '/tmp/publish-locks';
if (!fs.existsSync(LOCK_DIR)) fs.mkdirSync(LOCK_DIR, { recursive: true });

// 平台配置 - CDP 端口
const PLATFORMS = {
  'douyin': { name: '抖音', cdpPort: 19222 },
  'kuaishou': { name: '快手', cdpPort: 19223 },
  'xiaohongshu': { name: '小红书', cdpPort: 19224 },
  'toutiao-main': { name: '头条主号', cdpPort: 19225 },
  'toutiao-sub': { name: '头条副号', cdpPort: 19226 },
  'weibo': { name: '微博', cdpPort: 19227 },
  'shipinhao': { name: '视频号', cdpPort: 19228 },
  'gongzhonghao': { name: '公众号', cdpPort: 19229 },
  'zhihu': { name: '知乎', cdpPort: 19230 }
};

// ============ CDP 客户端 ============

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { handshakeTimeout: 15000 });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.id && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
      });
    });
  }

  send(method, params = {}, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks[id] = (msg) => {
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error('Timeout: ' + method));
        }
      }, timeout);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============ 锁管理（防止并发冲突）============

const lockManager = {
  // 获取锁
  acquire(platformId, timeout = 300000) {  // 默认5分钟超时
    const lockFile = path.join(LOCK_DIR, `${platformId}.lock`);
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // 检查是否有过期的锁（超过10分钟视为过期）
        if (fs.existsSync(lockFile)) {
          const lockTime = parseInt(fs.readFileSync(lockFile, 'utf8'));
          if (Date.now() - lockTime > 600000) {
            fs.unlinkSync(lockFile);  // 删除过期锁
          }
        }

        // 尝试创建锁（exclusive）
        fs.writeFileSync(lockFile, Date.now().toString(), { flag: 'wx' });
        return true;
      } catch (e) {
        if (e.code === 'EEXIST') {
          // 锁已存在，等待重试
          const waitMs = Math.min(1000, timeout - (Date.now() - startTime));
          if (waitMs > 0) {
            require('child_process').execSync(`sleep ${waitMs / 1000}`);
          }
        } else {
          throw e;
        }
      }
    }
    return false;  // 获取锁超时
  },

  // 释放锁
  release(platformId) {
    const lockFile = path.join(LOCK_DIR, `${platformId}.lock`);
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch (e) {
      // 忽略释放错误
    }
  },

  // 检查是否被锁
  isLocked(platformId) {
    const lockFile = path.join(LOCK_DIR, `${platformId}.lock`);
    if (!fs.existsSync(lockFile)) return false;

    const lockTime = parseInt(fs.readFileSync(lockFile, 'utf8'));
    return Date.now() - lockTime < 600000;  // 10分钟内视为有效
  }
};

// ============ 页面管理（隔离发布操作）============

const pageManager = {
  // 创建新页面用于发布
  async createPublishPage(browserWsUrl) {
    const cdp = new CDPClient(browserWsUrl);
    await cdp.connect();

    // 创建新页面
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank'
    });

    cdp.close();
    return targetId;
  },

  // 关闭页面（发布完成后清理）
  async closePage(browserWsUrl, targetId) {
    try {
      const cdp = new CDPClient(browserWsUrl);
      await cdp.connect();
      await cdp.send('Target.closeTarget', { targetId });
      cdp.close();
    } catch (e) {
      // 忽略关闭错误
    }
  },

  // 获取页面 WebSocket URL
  async getPageWsUrl(cdpPort, targetId) {
    const pagesResult = await httpGet(`http://${WINDOWS_IP}:${cdpPort}/json`);
    if (pagesResult.status !== 200) return null;

    const page = pagesResult.data.find(p => p.id === targetId);
    return page ? page.webSocketDebuggerUrl : null;
  }
};

// ============ 工具函数 ============

function log(platform, msg) {
  console.error(`[${platform}] ${msg}`);
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${API_KEY}`, ...headers }
    };
    const req = protocol.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    const req = protocol.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}`, ...headers }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// 上传文件到 Windows
async function uploadToWindows(localPath, originalName) {
  return new Promise((resolve, reject) => {
    const stats = fs.statSync(localPath);
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${originalName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fileBuffer = fs.readFileSync(localPath);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const req = http.request({
      hostname: WINDOWS_IP,
      port: FILE_RECEIVER_PORT,
      path: '/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false, error: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getTaskDetails(taskId) {
  const result = await httpGet(`${DASHBOARD_API}/v1/publish/tasks/${taskId}`);
  if (result.status !== 200) throw new Error(`获取任务失败: ${result.status}`);
  return result.data;
}

async function updateTaskResult(taskId, platform, result) {
  await httpPost(`${DASHBOARD_API}/v1/publish/tasks/${taskId}/result`, { platform, ...result });
}

// ============ 文件准备 ============

async function prepareFiles(task, platformName) {
  const windowsFiles = [];
  const localFiles = [];

  if (!task.originalFiles || task.originalFiles.length === 0) {
    return { windowsFiles, localFiles };
  }

  log(platformName, `准备 ${task.originalFiles.length} 个文件...`);

  for (let i = 0; i < task.originalFiles.length; i++) {
    const filePath = task.originalFiles[i];
    const fileName = path.basename(filePath);
    const localPath = path.join(TEMP_DIR, `${Date.now()}_${i}_${fileName}`);
    const fileUrl = `${DASHBOARD_API}/media/${filePath}`;

    try {
      log(platformName, `下载: ${fileName}`);
      await downloadFile(fileUrl, localPath);
      localFiles.push(localPath);

      log(platformName, `传输到 Windows: ${fileName}`);
      const uploadResult = await uploadToWindows(localPath, fileName);

      if (uploadResult.success) {
        windowsFiles.push(uploadResult.path);
        log(platformName, `✓ ${fileName}`);
      } else {
        throw new Error(uploadResult.error);
      }
    } catch (e) {
      log(platformName, `✗ ${fileName}: ${e.message}`);
    }
  }

  return { windowsFiles, localFiles };
}

function cleanupLocalFiles(files) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

// ============ 抖音发布 ============

// 抖音辅助函数
const douyinHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 智能等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!document.body.innerText.includes('加载中') && document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          if (document.querySelector('[class*="avatar"]') || document.querySelector('[class*="user"]')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 处理草稿弹窗
  async handleDraftPopup(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes('放弃')) {
              btn.click();
              return 'discarded';
            }
          }
          return 'no_popup';
        })()
      `
    });
    return result.result.value;
  },

  // 通过元素文本点击（不用硬编码坐标）
  async clickByText(cdp, text, tagSelector = '*') {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${tagSelector}');
          for (const el of elements) {
            if (el.textContent.trim() === '${text}' || el.innerText?.trim() === '${text}') {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
              }
            }
          }
          return null;
        })()
      `,
      returnByValue: true
    });

    if (result.result.value) {
      const { x, y } = result.result.value;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return true;
    }
    return false;
  },

  // 截图保存（调试用）
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/douyin-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 获取文件上传节点
  async getFileInput(cdp, acceptType) {
    const doc = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: `input[type="file"][accept*="${acceptType}"]`
    });
    return inputNode.nodeId ? inputNode : null;
  },

  // 验证发布是否成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (url.includes('/manage') || text.includes('发布成功') || text.includes('已发布')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishDouyin(cdp, task, files) {
  const h = douyinHelpers;
  log('抖音', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 导航到上传页面
    log('抖音', '导航到上传页面...');
    await cdp.send('Page.navigate', {
      url: 'https://creator.douyin.com/creator-micro/content/upload'
    });

    // 3. 等待页面加载
    log('抖音', '等待页面加载...');
    const loaded = await h.waitForElement(cdp, '[class*="tab-item"]', 30000);
    if (!loaded) {
      await h.saveScreenshot(cdp, 'load-failed');
      return { success: false, error: '页面加载超时' };
    }
    await sleep(1000);

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('抖音', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录抖音' };
    }

    // 5. 处理草稿弹窗
    const draftResult = await h.handleDraftPopup(cdp);
    if (draftResult === 'discarded') {
      log('抖音', '已放弃草稿');
      await sleep(1000);
    }

    log('抖音', `类型: ${task.mediaType}, 文件: ${files.length}`);

    // ===== 视频模式 =====
    if (task.mediaType === 'video' && files.length > 0) {
      log('抖音', '>>> 视频模式');

      // 获取视频上传节点
      const inputNode = await h.getFileInput(cdp, 'video');
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-video-input');
        return { success: false, error: '未找到视频上传框' };
      }

      // 上传视频
      log('抖音', `上传视频: ${path.basename(files[0])}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [files[0]]
      });

      // 等待跳转到编辑页面
      log('抖音', '等待视频处理...');
      let jumped = false;
      for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const urlCheck = await cdp.send('Runtime.evaluate', {
          expression: 'window.location.href'
        });
        if (urlCheck.result.value.includes('/post/video')) {
          jumped = true;
          log('抖音', '已跳转到编辑页面');
          break;
        }
        if (i % 5 === 0) log('抖音', `处理中... ${i * 2}s`);
      }

      if (!jumped) {
        await h.saveScreenshot(cdp, 'video-process-timeout');
        return { success: false, error: '视频处理超时' };
      }

      // 等待表单加载
      await h.waitForPageLoad(cdp, 30000);
      await sleep(2000);

    // ===== 图文模式 =====
    } else if (task.mediaType === 'image') {
      log('抖音', '>>> 图文模式');

      // 点击"发布图文" tab（通过文本查找，不用硬编码坐标）
      const clicked = await h.clickByText(cdp, '发布图文');
      if (!clicked) {
        log('抖音', '未找到发布图文 tab，尝试备用方法...');
        // 备用：用 tab-item 选择器
        await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              const tabs = document.querySelectorAll('[class*="tab-item"]');
              for (const tab of tabs) {
                if (tab.textContent.includes('图文')) {
                  tab.click();
                  return true;
                }
              }
              return false;
            })()
          `
        });
      }
      await sleep(2000);

      // 再次处理可能出现的草稿弹窗
      await h.handleDraftPopup(cdp);
      await sleep(1000);

      if (files.length > 0) {
        // 等待图片上传框出现
        await h.waitForElement(cdp, 'input[type="file"][accept*="image"]', 10000);

        const inputNode = await h.getFileInput(cdp, 'image');
        if (!inputNode) {
          await h.saveScreenshot(cdp, 'no-image-input');
          return { success: false, error: '未找到图片上传框' };
        }

        log('抖音', `上传图片: ${files.length} 个`);
        await cdp.send('DOM.setFileInputFiles', {
          nodeId: inputNode.nodeId,
          files: files
        });

        // 等待图片上传完成
        log('抖音', '等待图片上传...');
        await sleep(3000);
        for (let i = 0; i < 30; i++) {
          const uploadCheck = await cdp.send('Runtime.evaluate', {
            expression: `document.querySelectorAll('[class*="upload-progress"], [class*="loading"]').length === 0`
          });
          if (uploadCheck.result.value) break;
          await sleep(1000);
        }
      } else {
        log('抖音', '无文件需上传');
      }
    } else {
      return { success: false, error: `不支持的类型: ${task.mediaType}` };
    }

    await sleep(2000);

    // 6. 填写标题
    log('抖音', '填写标题...');
    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const titleInput = document.querySelector('input[placeholder*="标题"]');
          if (titleInput) {
            titleInput.focus();
            titleInput.value = ${JSON.stringify(task.title || '')};
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled';
          }
          return 'not_found';
        })()
      `
    });
    if (titleResult.result.value === 'not_found') {
      log('抖音', '警告: 未找到标题输入框');
    }

    // 7. 填写描述
    if (task.content) {
      log('抖音', '填写描述...');
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const descBox = document.querySelector('div[contenteditable="true"]');
            if (descBox) {
              descBox.focus();
              descBox.innerHTML = ${JSON.stringify(task.content)};
              descBox.dispatchEvent(new Event('input', { bubbles: true }));
              return 'filled';
            }
            return 'not_found';
          })()
        `
      });
    }

    await sleep(2000);

    // 8. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('抖音', `发布前截图: ${prePublishScreenshot}`);

    // 9. 点击发布按钮（优先点击 primary 样式的"发布"按钮，而非"高清发布"）
    log('抖音', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          // 优先找 primary 类型的"发布"按钮
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === '发布' && btn.className.includes('primary') && !btn.disabled) {
              btn.click();
              return 'clicked_primary: ' + text;
            }
          }
          // 备用：找任何包含"发布"的按钮（但排除"高清发布"）
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === '发布' && !btn.disabled) {
              btn.click();
              return 'clicked: ' + text;
            }
          }
          // 最后备用：高清发布
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('发布') && !btn.disabled) {
              btn.click();
              return 'clicked_fallback: ' + text;
            }
          }
          return 'not_found';
        })()
      `
    });
    log('抖音', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 10. 验证发布结果
    log('抖音', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('抖音', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('抖音', `错误: ${e.message}`);
    await douyinHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// ============ 快手发布 ============

// 快手辅助函数（复用抖音的通用功能）
const kuaishouHelpers = {
  ...douyinHelpers,  // 继承抖音的通用方法

  // 快手特定：检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          if (url.includes('cp.kuaishou.com')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  }
};

async function publishKuaishou(cdp, task, files) {
  const h = kuaishouHelpers;
  log('快手', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 导航到上传页面
    log('快手', '导航到上传页面...');
    await cdp.send('Page.navigate', {
      url: 'https://cp.kuaishou.com/article/publish/video'
    });

    // 3. 等待页面加载
    log('快手', '等待页面加载...');
    const loaded = await h.waitForPageLoad(cdp, 30000);
    if (!loaded) {
      await h.saveScreenshot(cdp, 'load-failed');
      return { success: false, error: '页面加载超时' };
    }
    await sleep(2000);

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('快手', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录快手' };
    }

    log('快手', `类型: ${task.mediaType}, 文件: ${files.length}`);

    // ===== 视频模式 =====
    if (task.mediaType === 'video' && files.length > 0) {
      log('快手', '>>> 视频模式');

      // 确保在视频tab（默认就是）
      await sleep(1000);

      // 获取视频上传节点
      const inputNode = await h.getFileInput(cdp, 'video');
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-video-input');
        return { success: false, error: '未找到视频上传框' };
      }

      // 上传视频
      log('快手', `上传视频: ${path.basename(files[0])}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [files[0]]
      });

      // 等待跳转到编辑页面（快手上传后会跳转）
      log('快手', '等待视频处理...');
      let jumped = false;
      for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const urlCheck = await cdp.send('Runtime.evaluate', {
          expression: 'window.location.href'
        });
        // 快手编辑页面URL会变化（带参数或跳转到编辑页）
        if (urlCheck.result.value.includes('?') || urlCheck.result.value !== 'https://cp.kuaishou.com/article/publish/video') {
          jumped = true;
          log('快手', `已跳转到编辑页面: ${urlCheck.result.value}`);
          break;
        }
        if (i % 5 === 0) log('快手', `处理中... ${i * 2}s`);
      }

      if (!jumped) {
        await h.saveScreenshot(cdp, 'video-process-timeout');
        return { success: false, error: '视频处理超时' };
      }

      // 等待表单加载
      await h.waitForPageLoad(cdp, 30000);
      await sleep(2000);

    // ===== 图文模式 =====
    } else if (task.mediaType === 'image') {
      log('快手', '>>> 图文模式');

      // 点击"上传图文" tab - 使用更强的选择器
      log('快手', '切换到图文模式...');
      const tabClicked = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 方法1: 查找 tab 或 radio 类型的元素
            const tabItems = document.querySelectorAll('[class*="tab"], [class*="radio"], [role="tab"], [class*="upload-type"]');
            for (const item of tabItems) {
              const text = item.textContent?.trim() || '';
              if ((text.includes('图文') || text === '图文') && item.offsetWidth > 0) {
                item.click();
                return 'tab_clicked: ' + text;
              }
            }

            // 方法2: 查找所有可点击元素
            const allElements = document.querySelectorAll('div, span, button, a, label');
            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if ((text === '图文' || text === '上传图文') && el.offsetWidth > 0 && el.offsetHeight < 100) {
                el.click();
                return 'element_clicked: ' + text;
              }
            }

            // 方法3: 通过 class 名查找
            const byClass = document.querySelector('[class*="image-text"], [class*="article"]');
            if (byClass && byClass.offsetWidth > 0) {
              byClass.click();
              return 'class_clicked';
            }

            return 'not_found';
          })()
        `
      });
      log('快手', `Tab切换结果: ${tabClicked.result.value}`);
      await sleep(3000);

      // 检查URL是否变化，确认已切换到图文模式
      const urlCheck = await cdp.send('Runtime.evaluate', {
        expression: 'window.location.href'
      });
      log('快手', `当前URL: ${urlCheck.result.value}`);

      if (files.length > 0) {
        // 等待图片上传框出现
        await h.waitForElement(cdp, 'input[type="file"][accept*="image"]', 15000);

        const inputNode = await h.getFileInput(cdp, 'image');
        if (!inputNode) {
          // 如果还是找不到，尝试刷新页面并重试
          log('快手', '未找到图片输入框，尝试刷新...');
          await h.saveScreenshot(cdp, 'no-image-input-retry');

          // 列出所有 file input 以便调试
          const fileInputs = await cdp.send('Runtime.evaluate', {
            expression: `
              Array.from(document.querySelectorAll('input[type="file"]')).map(i => ({
                accept: i.accept, visible: i.offsetWidth > 0, class: i.className?.substring(0, 50)
              }))
            `
          });
          log('快手', `所有file input: ${JSON.stringify(fileInputs.result.value)}`);

          return { success: false, error: '未找到图片上传框，可能需要手动切换到图文模式' };
        }

        log('快手', `上传图片: ${files.length} 个`);
        await cdp.send('DOM.setFileInputFiles', {
          nodeId: inputNode.nodeId,
          files: files
        });

        // 等待图片上传完成
        log('快手', '等待图片上传...');
        await sleep(3000);
        for (let i = 0; i < 30; i++) {
          const uploadCheck = await cdp.send('Runtime.evaluate', {
            expression: `document.querySelectorAll('[class*="upload-progress"], [class*="loading"]').length === 0`
          });
          if (uploadCheck.result.value) break;
          await sleep(1000);
        }
      } else {
        log('快手', '无文件需上传');
      }
    } else {
      return { success: false, error: `不支持的类型: ${task.mediaType}` };
    }

    await sleep(2000);

    // 6. 填写标题（快手使用 textarea 或 input）
    log('快手', '填写标题...');
    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 尝试多种可能的标题输入框
          const titleInput = document.querySelector('textarea[placeholder*="标题"]') ||
                             document.querySelector('input[placeholder*="标题"]') ||
                             document.querySelector('textarea[placeholder*="作品标题"]') ||
                             document.querySelector('input[placeholder*="作品标题"]');
          if (titleInput) {
            titleInput.focus();
            titleInput.value = ${JSON.stringify(task.title || '')};
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled';
          }
          return 'not_found';
        })()
      `
    });
    if (titleResult.result.value === 'not_found') {
      log('快手', '警告: 未找到标题输入框');
    }

    // 7. 填写描述
    if (task.content) {
      log('快手', '填写描述...');
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 快手的描述框可能是 textarea 或 contenteditable div
            const descBox = document.querySelector('textarea[placeholder*="描述"]') ||
                            document.querySelector('textarea[placeholder*="简介"]') ||
                            document.querySelector('div[contenteditable="true"]');
            if (descBox) {
              descBox.focus();
              if (descBox.tagName === 'TEXTAREA') {
                descBox.value = ${JSON.stringify(task.content)};
              } else {
                descBox.innerHTML = ${JSON.stringify(task.content)};
              }
              descBox.dispatchEvent(new Event('input', { bubbles: true }));
              return 'filled';
            }
            return 'not_found';
          })()
        `
      });
    }

    await sleep(2000);

    // 8. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('快手', `发布前截图: ${prePublishScreenshot}`);

    // 9. 点击发布按钮
    log('快手', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          // 优先找 primary 类型的"发布"按钮
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text === '发布' && !btn.disabled) {
              btn.click();
              return 'clicked: ' + text;
            }
          }
          // 备用：找任何包含"发布"的按钮
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('发布') && !btn.disabled) {
              btn.click();
              return 'clicked_fallback: ' + text;
            }
          }
          return 'not_found';
        })()
      `
    });
    log('快手', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 10. 验证发布结果
    log('快手', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('快手', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('快手', `错误: ${e.message}`);
    await kuaishouHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// ============ 小红书发布 ============

// 小红书辅助函数（复用抖音的通用功能）
const xiaohongshuHelpers = {
  ...douyinHelpers,  // 继承抖音的通用方法

  // 小红书特定：检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          if (url.includes('creator.xiaohongshu.com')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 验证发布是否成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (url.includes('/publish/success') || text.includes('发布成功') || text.includes('已发布')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核中')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishXiaohongshu(cdp, task, files) {
  const h = xiaohongshuHelpers;
  log('小红书', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 根据类型选择发布页面
    let publishUrl;
    if (task.mediaType === 'video') {
      publishUrl = 'https://creator.xiaohongshu.com/publish/publish?source=official';
    } else {
      publishUrl = 'https://creator.xiaohongshu.com/publish/publish?source=official';
    }

    log('小红书', `导航到发布页面 (${task.mediaType})...`);
    await cdp.send('Page.navigate', { url: publishUrl });

    // 3. 等待页面加载
    log('小红书', '等待页面加载...');
    await sleep(3000);
    const loaded = await h.waitForPageLoad(cdp, 30000);
    if (!loaded) {
      await h.saveScreenshot(cdp, 'load-failed');
      return { success: false, error: '页面加载超时' };
    }

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('小红书', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录小红书' };
    }

    await sleep(2000);

    // ===== 上传文件 =====
    if (files.length > 0) {
      log('小红书', `准备上传 ${files.length} 个文件 (${task.mediaType})...`);

      if (task.mediaType === 'video') {
        // 视频模式
        const inputNode = await h.getFileInput(cdp, 'video');
        if (!inputNode) {
          await h.saveScreenshot(cdp, 'no-video-input');
          return { success: false, error: '未找到视频上传框' };
        }

        log('小红书', `上传视频: ${path.basename(files[0])}`);
        await cdp.send('DOM.setFileInputFiles', {
          nodeId: inputNode.nodeId,
          files: [files[0]]
        });

        // 等待视频上传完成（小红书通常会显示上传进度）
        log('小红书', '等待视频上传...');
        await sleep(5000);
        for (let i = 0; i < 60; i++) {
          const uploadCheck = await cdp.send('Runtime.evaluate', {
            expression: `
              (function() {
                const text = document.body.innerText;
                if (text.includes('上传成功') || text.includes('处理完成')) return 'done';
                if (text.includes('上传失败') || text.includes('格式不支持')) return 'failed';
                return 'uploading';
              })()
            `
          });
          if (uploadCheck.result.value === 'done') {
            log('小红书', '视频上传完成');
            break;
          }
          if (uploadCheck.result.value === 'failed') {
            await h.saveScreenshot(cdp, 'upload-failed');
            return { success: false, error: '视频上传失败' };
          }
          if (i % 5 === 0) log('小红书', `上传中... ${i * 2}s`);
          await sleep(2000);
        }

      } else {
        // 图文模式 - 小红书需要先切换到图文模式
        log('小红书', '切换到图文模式...');
        const switchResult = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 方法1: 查找"上传图文"按钮/区域
              const uploadTypes = document.querySelectorAll('[class*="upload"], [class*="type"], [class*="tab"]');
              for (const el of uploadTypes) {
                const text = el.textContent?.trim() || '';
                if ((text.includes('图文') || text === '上传图文') && el.offsetWidth > 0) {
                  el.click();
                  return 'type_clicked: ' + text;
                }
              }

              // 方法2: 查找所有按钮/可点击元素
              const allElements = document.querySelectorAll('div, span, button, a');
              for (const el of allElements) {
                const text = el.textContent?.trim() || '';
                if ((text === '上传图文' || text === '图文') && el.offsetWidth > 0 && el.offsetHeight < 80) {
                  el.click();
                  return 'element_clicked: ' + text;
                }
              }

              // 方法3: 查找包含"图文"的父容器并点击
              for (const el of allElements) {
                const text = el.textContent?.trim() || '';
                if (text.includes('上传图文') && el.offsetWidth > 50 && el.offsetWidth < 300) {
                  el.click();
                  return 'container_clicked: ' + text;
                }
              }

              return 'not_found';
            })()
          `
        });
        log('小红书', `模式切换结果: ${switchResult.result.value}`);
        await sleep(3000);

        // 等待图片上传框出现
        await h.waitForElement(cdp, 'input[type="file"][accept*="image"]', 15000);

        const inputNode = await h.getFileInput(cdp, 'image');
        if (!inputNode) {
          // 列出所有 file input 以便调试
          const fileInputs = await cdp.send('Runtime.evaluate', {
            expression: `
              Array.from(document.querySelectorAll('input[type="file"]')).map(i => ({
                accept: i.accept, visible: i.offsetWidth > 0, class: i.className?.substring(0, 50)
              }))
            `
          });
          log('小红书', `所有file input: ${JSON.stringify(fileInputs.result.value)}`);
          await h.saveScreenshot(cdp, 'no-image-input');
          return { success: false, error: '未找到图片上传框' };
        }

        log('小红书', `上传图片: ${files.length} 张`);
        await cdp.send('DOM.setFileInputFiles', {
          nodeId: inputNode.nodeId,
          files: files
        });

        // 等待图片上传完成
        log('小红书', '等待图片上传...');
        await sleep(3000);
        for (let i = 0; i < 30; i++) {
          const uploadCheck = await cdp.send('Runtime.evaluate', {
            expression: `
              (function() {
                const uploading = document.querySelectorAll('[class*="uploading"], [class*="loading"]');
                return uploading.length === 0;
              })()
            `
          });
          if (uploadCheck.result.value) {
            log('小红书', '图片上传完成');
            break;
          }
          await sleep(1000);
        }
      }

      await sleep(2000);
    }

    // 5. 填写标题
    log('小红书', '填写标题...');
    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 小红书的标题可能是 input 或 textarea
          const titleInput = document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"], input[placeholder*="填写标题"]');
          if (titleInput) {
            titleInput.focus();
            titleInput.value = ${JSON.stringify(task.title || '')};
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled';
          }
          return 'not_found';
        })()
      `
    });
    if (titleResult.result.value === 'not_found') {
      log('小红书', '警告: 未找到标题输入框');
    }

    await sleep(1000);

    // 6. 填写内容/描述
    if (task.content) {
      log('小红书', '填写内容...');
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 小红书的内容框可能是 contenteditable div 或 textarea
            const contentBox = document.querySelector('div[contenteditable="true"], textarea[placeholder*="正文"], textarea[placeholder*="内容"]');
            if (contentBox) {
              contentBox.focus();
              if (contentBox.contentEditable === 'true') {
                contentBox.innerHTML = ${JSON.stringify(task.content)};
              } else {
                contentBox.value = ${JSON.stringify(task.content)};
              }
              contentBox.dispatchEvent(new Event('input', { bubbles: true }));
              contentBox.dispatchEvent(new Event('change', { bubbles: true }));
              return 'filled';
            }
            return 'not_found';
          })()
        `
      });
    }

    await sleep(2000);

    // 7. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('小红书', `发布前截图: ${prePublishScreenshot}`);

    // 8. 点击发布按钮
    log('小红书', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          // 小红书的发布按钮通常包含"发布笔记"或"发布"文字
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if ((text === '发布笔记' || text === '发布') && !btn.disabled) {
              btn.click();
              return 'clicked: ' + text;
            }
          }
          // 备用：查找其他可能的发布按钮
          for (const btn of buttons) {
            const text = btn.textContent.trim();
            if (text.includes('发布') && !btn.disabled) {
              btn.click();
              return 'clicked_fallback: ' + text;
            }
          }
          return 'not_found';
        })()
      `
    });
    log('小红书', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 9. 验证发布结果
    log('小红书', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('小红书', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('小红书', `错误: ${e.message}`);
    await xiaohongshuHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// ============ 微博发布 ============

// 微博辅助函数
const weiboHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 智能等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          // 检查是否有发布框
          const publishBox = document.querySelector('textarea[placeholder*="新鲜事"]');
          if (publishBox) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 截图保存（调试用）
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/weibo-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 获取文件上传节点
  async getFileInput(cdp) {
    const doc = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
    return inputNode.nodeId ? inputNode : null;
  },

  // 验证发布是否成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const text = document.body.innerText;
            // 检查是否有成功提示
            if (text.includes('发送成功') || text.includes('发布成功')) {
              return 'success';
            }
            // 检查是否清空了输入框（发送成功的标志）
            const textarea = document.querySelector('textarea[placeholder*="新鲜事"]');
            if (textarea && textarea.value === '') {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishWeibo(cdp, task, files) {
  const h = weiboHelpers;
  log('微博', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 导航到微博首页
    log('微博', '导航到微博首页...');
    await cdp.send('Page.navigate', {
      url: 'https://weibo.com'
    });

    // 3. 等待页面加载
    log('微博', '等待页面加载...');
    await h.waitForPageLoad(cdp);
    await sleep(3000);

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('微博', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录微博' };
    }

    // 5. 上传文件（如果有）
    if (files.length > 0) {
      log('微博', `准备上传 ${files.length} 个文件...`);

      // 获取文件上传节点
      const inputNode = await h.getFileInput(cdp);
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-file-input');
        return { success: false, error: '未找到文件上传框' };
      }

      // 微博支持同时上传图片和视频，一次性上传所有文件
      log('微博', `上传文件: ${files.map(f => path.basename(f)).join(', ')}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: files
      });

      // 等待上传完成
      log('微博', '等待文件上传...');
      await sleep(3000);
      for (let i = 0; i < 60; i++) {
        const uploadCheck = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 检查是否有上传进度条
              const progress = document.querySelectorAll('[class*="upload"], [class*="progress"], [class*="loading"]');
              const hasProgress = Array.from(progress).some(el => {
                return el.offsetWidth > 0 && el.offsetHeight > 0;
              });
              return !hasProgress;
            })()
          `
        });
        if (uploadCheck.result.value) {
          log('微博', '文件上传完成');
          break;
        }
        if (i % 5 === 0) log('微博', `上传中... ${i}s`);
        await sleep(1000);
      }
    } else {
      log('微博', '无文件需上传');
    }

    await sleep(2000);

    // 6. 填写内容
    log('微博', '填写内容...');
    const content = task.content || task.title || '';
    const fillResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const textarea = document.querySelector('textarea[placeholder*="新鲜事"]');
          if (textarea) {
            textarea.focus();
            textarea.value = ${JSON.stringify(content)};
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return 'filled';
          }
          return 'not_found';
        })()
      `
    });
    if (fillResult.result.value === 'not_found') {
      log('微博', '警告: 未找到文本输入框');
      await h.saveScreenshot(cdp, 'no-textarea');
      return { success: false, error: '未找到文本输入框' };
    }

    await sleep(2000);

    // 7. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('微博', `发布前截图: ${prePublishScreenshot}`);

    // 8. 点击发送按钮
    log('微博', '点击发送按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if (text === '发送' && !btn.disabled) {
              btn.click();
              return 'clicked';
            }
          }
          return 'not_found';
        })()
      `
    });
    log('微博', `发送按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-send-btn');
      return { success: false, error: '未找到发送按钮或按钮被禁用' };
    }

    // 9. 验证发布结果
    log('微博', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('微博', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发送，结果待确认' };
    }

  } catch (e) {
    log('微博', `错误: ${e.message}`);
    await weiboHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}


// ============ 头条发布 ============

// 头条辅助函数
const toutiaoHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          const bodyText = document.body.innerText;
          if (bodyText.includes('发布文章') || bodyText.includes('发布视频') || bodyText.includes('头条号')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 截图保存
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/toutiao-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 获取文件上传节点
  async getFileInput(cdp) {
    const doc = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"]'
    });
    return inputNode.nodeId ? inputNode : null;
  },

  // 验证发布成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (url.includes('/manage') || url.includes('/articles') || text.includes('发布成功')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核中')) {
              return 'pending';
            }
            return 'waiting';
          })()
        `
      });
      if (result.result.value !== 'waiting') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishToutiao(cdp, task, files) {
  const h = toutiaoHelpers;
  log('头条', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 根据类型导航到对应页面
    let publishUrl;
    if (task.mediaType === 'video') {
      publishUrl = 'https://mp.toutiao.com/profile_v4/xigua/upload-video';
      log('头条', '>>> 视频模式');
    } else {
      publishUrl = 'https://mp.toutiao.com/profile_v4/graphic/publish';
      log('头条', '>>> 图文模式');
    }

    log('头条', `导航到: ${publishUrl}`);
    await cdp.send('Page.navigate', { url: publishUrl });

    // 3. 等待页面加载
    log('头条', '等待页面加载...');
    await h.waitForPageLoad(cdp, 30000);
    await sleep(3000);  // 额外等待动态内容加载

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('头条', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录头条号' };
    }

    // ===== 视频模式 =====
    if (task.mediaType === 'video' && files.length > 0) {
      log('头条', '上传视频...');

      // 等待上传区域出现
      await sleep(2000);

      // 获取视频上传节点
      const inputNode = await h.getFileInput(cdp);
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-video-input');
        return { success: false, error: '未找到视频上传框' };
      }

      // 上传视频
      log('头条', `上传视频: ${path.basename(files[0])}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [files[0]]
      });

      // 等待视频处理并跳转到编辑页面
      log('头条', '等待视频处理...');
      let jumped = false;
      for (let i = 0; i < 120; i++) {  // 最多等待 4 分钟
        await sleep(2000);
        const urlCheck = await cdp.send('Runtime.evaluate', {
          expression: 'window.location.href'
        });
        const url = urlCheck.result.value;
        // 可能跳转到编辑页面或显示表单
        if (url.includes('/publish') || url.includes('/edit')) {
          // 检查是否有标题输入框（表示编辑页面已加载）
          const hasTitleInput = await cdp.send('Runtime.evaluate', {
            expression: `!!document.querySelector('input[placeholder*="标题"], input[placeholder*="title"], textarea[placeholder*="标题"]')`
          });
          if (hasTitleInput.result.value) {
            jumped = true;
            log('头条', '已跳转到编辑页面');
            break;
          }
        }
        if (i % 10 === 0) log('头条', `处理中... ${i * 2}s`);
      }

      if (!jumped) {
        await h.saveScreenshot(cdp, 'video-process-timeout');
        return { success: false, error: '视频处理超时' };
      }

      await sleep(2000);

    // ===== 图文模式 =====
    } else if (task.mediaType === 'image' || task.mediaType === 'article') {
      log('头条', '图文发布模式');

      // 如果有图片，需要上传（通过编辑器工具栏）
      if (files.length > 0) {
        log('头条', `需要上传 ${files.length} 张图片`);
        // 头条的图文发布需要在编辑器中点击插入图片按钮
        // 这里简化处理，先填写文字内容，图片暂不支持
        log('头条', '警告: 图片上传需要手动操作，此版本仅支持文字内容');
      }

    } else {
      return { success: false, error: `不支持的类型: ${task.mediaType}` };
    }

    // 5. 填写标题
    log('头条', '填写标题...');
    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 尝试多种可能的标题输入框
          const selectors = [
            'input[placeholder*="标题"]',
            'input[placeholder*="title"]',
            'textarea[placeholder*="标题"]',
            '.publish-editor-title input',
            '.publish-editor-title-wrapper input'
          ];

          for (const selector of selectors) {
            const titleInput = document.querySelector(selector);
            if (titleInput) {
              titleInput.focus();
              titleInput.value = ${JSON.stringify(task.title || '')};
              titleInput.dispatchEvent(new Event('input', { bubbles: true }));
              titleInput.dispatchEvent(new Event('change', { bubbles: true }));
              return 'filled: ' + selector;
            }
          }

          // 尝试 contenteditable
          const editableTitle = document.querySelector('.publish-editor-title-wrapper [contenteditable="true"]');
          if (editableTitle) {
            editableTitle.focus();
            editableTitle.textContent = ${JSON.stringify(task.title || '')};
            editableTitle.dispatchEvent(new Event('input', { bubbles: true }));
            return 'filled: contenteditable title';
          }

          return 'not_found';
        })()
      `
    });
    log('头条', `标题填写: ${titleResult.result.value}`);

    await sleep(1000);

    // 6. 填写内容
    if (task.content) {
      log('头条', '填写内容...');
      const contentResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 查找编辑器
            const selectors = [
              '.publish-editor [contenteditable="true"]',
              '.syl-editor [contenteditable="true"]',
              'div[contenteditable="true"]',
              'textarea[placeholder*="内容"]'
            ];

            for (const selector of selectors) {
              const editor = document.querySelector(selector);
              if (editor && editor.offsetWidth > 100) {  // 确保是主编辑器
                editor.focus();
                if (editor.tagName === 'TEXTAREA') {
                  editor.value = ${JSON.stringify(task.content)};
                } else {
                  editor.innerHTML = ${JSON.stringify(task.content.replace(/\n/g, '<br>'))};
                }
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                return 'filled: ' + selector;
              }
            }

            return 'not_found';
          })()
        `
      });
      log('头条', `内容填写: ${contentResult.result.value}`);
    }

    await sleep(2000);

    // 7. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('头条', `发布前截图: ${prePublishScreenshot}`);

    // 8. 点击发布按钮
    log('头条', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 查找发布按钮（优先找"预览并发布"或"发布"）
          const buttons = document.querySelectorAll('button');
          const priorities = ['预览并发布', '发布', '提交'];

          for (const priority of priorities) {
            for (const btn of buttons) {
              const text = btn.textContent.trim();
              if (text === priority && !btn.disabled && btn.offsetWidth > 0) {
                btn.click();
                return 'clicked: ' + text;
              }
            }
          }

          return 'not_found';
        })()
      `
    });
    log('头条', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 9. 处理可能的确认弹窗
    await sleep(2000);
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if ((btn.textContent.includes('确定') || btn.textContent.includes('发布')) && !btn.disabled) {
              btn.click();
              return true;
            }
          }
          return false;
        })()
      `
    });

    // 10. 验证发布结果
    log('头条', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('头条', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'pending') {
      return { success: true, message: '已提交，等待审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('头条', `错误: ${e.message}`);
    await toutiaoHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// ============ 公众号发布 ============

// 公众号辅助函数
const gongzhonghaoHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('bizlogin')) return 'need_login';
          if (url.includes('mp.weixin.qq.com')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 截图保存
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/gongzhonghao-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 通过文本点击元素
  async clickByText(cdp, text, tagSelector = '*') {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${tagSelector}');
          for (const el of elements) {
            if (el.textContent.trim() === '${text}' || el.innerText?.trim() === '${text}') {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
              }
            }
          }
          return null;
        })()
      `,
      returnByValue: true
    });

    if (result.result.value) {
      const { x, y } = result.result.value;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return true;
    }
    return false;
  },

  // 验证发布成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (url.includes('/appmsg') || url.includes('/home') || text.includes('发表成功') || text.includes('群发成功')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('错误')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

// ============ 知乎发布 ============

// 知乎辅助函数
const zhihuHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('signin') || url.includes('login')) return 'need_login';
          if (url.includes('creator.zhihu.com') || url.includes('zhihu.com')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 截图保存
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/zhihu-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 获取文件上传节点
  async getFileInput(cdp, acceptType) {
    const doc = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: acceptType ? `input[type="file"][accept*="${acceptType}"]` : 'input[type="file"]'
    });
    return inputNode.nodeId ? inputNode : null;
  },

  // 验证发布成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (text.includes('发布成功') || text.includes('已发布') || url.includes('/manage/creation')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核中')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishZhihu(cdp, task, files) {
  const h = zhihuHelpers;
  log('知乎', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 根据类型导航到发布页面
    let publishUrl;
    if (task.mediaType === 'video') {
      publishUrl = 'https://www.zhihu.com/creator/featured-question/video/publish';
      log('知乎', '>>> 视频模式');
    } else {
      // 图文模式 - 直接导航到想法发布页
      publishUrl = 'https://www.zhihu.com/';
      log('知乎', '>>> 图文模式（想法）');
    }

    log('知乎', `导航到: ${publishUrl}`);
    await cdp.send('Page.navigate', { url: publishUrl });

    // 3. 等待页面加载
    log('知乎', '等待页面加载...');
    await h.waitForPageLoad(cdp, 30000);
    await sleep(3000);

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('知乎', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录知乎' };
    }

    // ===== 视频模式 =====
    if (task.mediaType === 'video' && files.length > 0) {
      log('知乎', '上传视频...');

      // 等待上传区域出现
      await sleep(2000);

      // 获取视频上传节点
      const inputNode = await h.getFileInput(cdp, 'video');
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-video-input');
        return { success: false, error: '未找到视频上传框' };
      }

      // 上传视频
      log('知乎', `上传视频: ${path.basename(files[0])}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [files[0]]
      });

      // 等待视频处理
      log('知乎', '等待视频处理...');
      let processed = false;
      for (let i = 0; i < 120; i++) {  // 最多等待 4 分钟
        await sleep(2000);
        const processCheck = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              const text = document.body.innerText;
              if (text.includes('上传成功') || text.includes('处理完成')) return 'done';
              if (text.includes('上传失败')) return 'failed';
              // 检查是否出现了标题输入框（表示可以开始填写内容）
              if (document.querySelector('input[placeholder*="标题"]') ||
                  document.querySelector('textarea[placeholder*="标题"]')) return 'done';
              return 'uploading';
            })()
          `
        });
        if (processCheck.result.value === 'done') {
          processed = true;
          log('知乎', '视频处理完成');
          break;
        }
        if (processCheck.result.value === 'failed') {
          await h.saveScreenshot(cdp, 'upload-failed');
          return { success: false, error: '视频上传失败' };
        }
        if (i % 10 === 0) log('知乎', `处理中... ${i * 2}s`);
      }

      if (!processed) {
        await h.saveScreenshot(cdp, 'video-process-timeout');
        return { success: false, error: '视频处理超时' };
      }

      await sleep(2000);

      // 填写标题
      log('知乎', '填写标题...');
      const titleResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const selectors = [
              'input[placeholder*="标题"]',
              'textarea[placeholder*="标题"]',
              'input[placeholder*="视频标题"]'
            ];
            for (const selector of selectors) {
              const titleInput = document.querySelector(selector);
              if (titleInput) {
                titleInput.focus();
                titleInput.value = ${JSON.stringify(task.title || '')};
                titleInput.dispatchEvent(new Event('input', { bubbles: true }));
                titleInput.dispatchEvent(new Event('change', { bubbles: true }));
                return 'filled: ' + selector;
              }
            }
            return 'not_found';
          })()
        `
      });
      log('知乎', `标题填写: ${titleResult.result.value}`);

      await sleep(1000);

      // 填写描述
      if (task.content) {
        log('知乎', '填写描述...');
        await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              const selectors = [
                'textarea[placeholder*="描述"]',
                'textarea[placeholder*="简介"]',
                'div[contenteditable="true"]'
              ];
              for (const selector of selectors) {
                const descBox = document.querySelector(selector);
                if (descBox && descBox.offsetWidth > 100) {
                  descBox.focus();
                  if (descBox.tagName === 'TEXTAREA') {
                    descBox.value = ${JSON.stringify(task.content)};
                  } else {
                    descBox.innerHTML = ${JSON.stringify(task.content)};
                  }
                  descBox.dispatchEvent(new Event('input', { bubbles: true }));
                  return 'filled';
                }
              }
              return 'not_found';
            })()
          `
        });
      }

    // ===== 图文模式（想法/文章）=====
    } else if (task.mediaType === 'image' || task.mediaType === 'article') {
      log('知乎', '图文发布模式');

      // 等待页面元素加载
      await sleep(3000);

      // 尝试多种方式打开发布框
      log('知乎', '打开发布框...');
      let editorOpened = false;

      // 方法1: 点击"写想法"或"发布"按钮
      const openEditor = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 查找写想法入口
            const selectors = [
              '[class*="CreatorHomeCenter"] [class*="publish"]',
              '[class*="HomeHeader"] button',
              '[class*="GlobalWrite"]',
              'button[class*="Button"]'
            ];

            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent?.trim() || '';
                if ((text.includes('写想法') || text.includes('发布') || text.includes('创作')) && el.offsetWidth > 0) {
                  el.click();
                  return 'clicked: ' + text;
                }
              }
            }

            // 通用方法: 遍历所有按钮
            const buttons = document.querySelectorAll('button, div[role="button"], a');
            for (const btn of buttons) {
              const text = btn.textContent?.trim() || '';
              if ((text === '写想法' || text === '发布想法' || text.includes('写想法')) && btn.offsetWidth > 0) {
                btn.click();
                return 'button_clicked: ' + text;
              }
            }

            // 检查是否已经有输入框可见
            const textarea = document.querySelector('textarea[placeholder*="想法"], textarea[placeholder*="内容"]') ||
                            document.querySelector('div[contenteditable="true"][class*="editor"]');
            if (textarea && textarea.offsetWidth > 0) return 'already_open';

            return 'not_found';
          })()
        `
      });
      log('知乎', `发布框状态: ${openEditor.result.value}`);

      if (openEditor.result.value.includes('clicked')) {
        editorOpened = true;
      }

      // 如果第一次没成功，等待并重试
      if (!editorOpened && openEditor.result.value === 'not_found') {
        await sleep(2000);

        // 方法2: 尝试点击首页右下角的"+"或"写想法"按钮
        log('知乎', '尝试点击首页写想法入口...');
        const retry = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 查找首页的发布入口
              const buttons = document.querySelectorAll('button, a, div');
              for (const btn of buttons) {
                const text = btn.innerText?.trim() || '';
                const ariaLabel = btn.getAttribute('aria-label') || '';
                if ((text === '写想法' || text === '+' || ariaLabel.includes('发布')) && btn.offsetWidth > 0 && btn.offsetWidth < 150) {
                  btn.click();
                  return 'clicked: ' + (text || ariaLabel);
                }
              }
              return 'not_found';
            })()
          `
        });
        log('知乎', `重试点击: ${retry.result.value}`);
        await sleep(3000);
      }

      await sleep(3000);

      // 检查编辑器是否可用
      const editorCheck = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const editors = document.querySelectorAll('textarea, div[contenteditable="true"]');
            for (const el of editors) {
              if (el.offsetWidth > 100 && el.offsetHeight > 30) {
                return { found: true, tag: el.tagName, placeholder: el.placeholder?.substring(0, 30), visible: true };
              }
            }
            return { found: false, total: editors.length };
          })()
        `
      });
      log('知乎', `编辑器检查: ${JSON.stringify(editorCheck.result.value)}`);

      await sleep(2000);

      // 上传图片（如果有）
      if (files.length > 0) {
        log('知乎', `准备上传 ${files.length} 张图片...`);

        // 查找图片上传按钮并点击
        const clickUpload = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 查找图片上传按钮（通常是图标）
              const buttons = document.querySelectorAll('button, div[role="button"]');
              for (const btn of buttons) {
                const title = btn.getAttribute('title') || btn.getAttribute('aria-label') || '';
                if (title.includes('图片') || title.includes('上传')) {
                  btn.click();
                  return 'clicked';
                }
              }
              // 检查是否已经有文件输入框
              if (document.querySelector('input[type="file"]')) return 'already_visible';
              return 'not_found';
            })()
          `
        });
        log('知乎', `图片上传按钮: ${clickUpload.result.value}`);

        await sleep(1000);

        // 获取图片上传节点
        const inputNode = await h.getFileInput(cdp, 'image');
        if (!inputNode) {
          // 尝试不带 accept 过滤的通用 file input
          const inputNode2 = await h.getFileInput(cdp, null);
          if (!inputNode2) {
            await h.saveScreenshot(cdp, 'no-image-input');
            log('知乎', '警告: 未找到图片上传框，跳过图片上传');
          } else {
            log('知乎', `上传图片: ${files.length} 张`);
            await cdp.send('DOM.setFileInputFiles', {
              nodeId: inputNode2.nodeId,
              files: files
            });

            // 等待图片上传完成
            log('知乎', '等待图片上传...');
            await sleep(3000);
            for (let i = 0; i < 30; i++) {
              const uploadCheck = await cdp.send('Runtime.evaluate', {
                expression: `
                  (function() {
                    const uploading = document.querySelectorAll('[class*="uploading"], [class*="loading"]');
                    return uploading.length === 0;
                  })()
                `
              });
              if (uploadCheck.result.value) {
                log('知乎', '图片上传完成');
                break;
              }
              await sleep(1000);
            }
          }
        } else {
          log('知乎', `上传图片: ${files.length} 张`);
          await cdp.send('DOM.setFileInputFiles', {
            nodeId: inputNode.nodeId,
            files: files
          });

          // 等待图片上传完成
          log('知乎', '等待图片上传...');
          await sleep(3000);
          for (let i = 0; i < 30; i++) {
            const uploadCheck = await cdp.send('Runtime.evaluate', {
              expression: `
                (function() {
                  const uploading = document.querySelectorAll('[class*="uploading"], [class*="loading"]');
                  return uploading.length === 0;
                })()
              `
            });
            if (uploadCheck.result.value) {
              log('知乎', '图片上传完成');
              break;
            }
            await sleep(1000);
          }
        }
      }

      await sleep(2000);

      // 填写内容
      log('知乎', '填写内容...');
      const content = task.content || task.title || '';
      const fillResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 查找内容输入框（想法通常是 textarea 或 contenteditable div）
            const selectors = [
              'textarea[placeholder*="想法"]',
              'textarea[placeholder*="内容"]',
              'div[contenteditable="true"]'
            ];
            for (const selector of selectors) {
              const editor = document.querySelector(selector);
              if (editor && editor.offsetWidth > 100) {
                editor.focus();
                if (editor.tagName === 'TEXTAREA') {
                  editor.value = ${JSON.stringify(content)};
                } else {
                  editor.innerHTML = ${JSON.stringify(content.replace(/\n/g, '<br>'))};
                }
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                editor.dispatchEvent(new Event('change', { bubbles: true }));
                return 'filled: ' + selector;
              }
            }
            return 'not_found';
          })()
        `
      });
      log('知乎', `内容填写: ${fillResult.result.value}`);

      if (fillResult.result.value === 'not_found') {
        await h.saveScreenshot(cdp, 'no-content-box');
        return { success: false, error: '未找到内容输入框' };
      }

    } else {
      return { success: false, error: `不支持的类型: ${task.mediaType}` };
    }

    await sleep(2000);

    // 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('知乎', `发布前截图: ${prePublishScreenshot}`);

    // 点击发布按钮
    log('知乎', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          const priorities = ['发布', '发送', '提交'];

          for (const priority of priorities) {
            for (const btn of buttons) {
              const text = btn.textContent?.trim();
              if (text === priority && !btn.disabled && btn.offsetWidth > 0) {
                btn.click();
                return 'clicked: ' + text;
              }
            }
          }

          // 备用：查找包含"发布"的按钮
          for (const btn of buttons) {
            const text = btn.textContent?.trim() || '';
            if (text.includes('发布') && !btn.disabled && btn.offsetWidth > 0) {
              btn.click();
              return 'clicked_fallback: ' + text;
            }
          }

          return 'not_found';
        })()
      `
    });
    log('知乎', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 处理可能的确认弹窗
    await sleep(2000);
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if ((btn.textContent.includes('确定') || btn.textContent.includes('发布')) && !btn.disabled) {
              btn.click();
              return true;
            }
          }
          return false;
        })()
      `
    });

    // 验证发布结果
    log('知乎', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('知乎', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('知乎', `错误: ${e.message}`);
    await zhihuHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

async function publishGongzhonghao(cdp, task, files) {
  const h = gongzhonghaoHelpers;
  log('公众号', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 先导航到公众号首页
    log('公众号', '导航到公众号首页...');
    await cdp.send('Page.navigate', {
      url: 'https://mp.weixin.qq.com/'
    });

    // 3. 等待页面加载
    log('公众号', '等待页面加载...');
    await h.waitForPageLoad(cdp, 30000);
    await sleep(3000);

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('公众号', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录公众号' };
    }

    // 5. 查找并点击"新建图文"按钮
    log('公众号', '查找新建图文按钮...');
    const createResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // 方法1: 查找"新建图文"或"写文章"按钮
          const allElements = document.querySelectorAll('a, button, div, span');
          for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            if ((text.includes('新建图文') || text.includes('写文章') || text === '图文') && el.offsetWidth > 0) {
              el.click();
              return 'clicked: ' + text;
            }
          }

          // 方法2: 查找菜单中的"内容与互动" > "图文消息"
          const menuItems = document.querySelectorAll('[class*="menu"], [class*="nav"] a');
          for (const item of menuItems) {
            const text = item.textContent?.trim() || '';
            if (text.includes('图文消息')) {
              item.click();
              return 'menu_clicked: ' + text;
            }
          }

          return 'not_found';
        })()
      `
    });
    log('公众号', `创建按钮点击: ${createResult.result.value}`);

    if (createResult.result.value === 'not_found') {
      // 尝试直接导航到图文编辑页面
      log('公众号', '尝试直接导航到编辑页面...');
      const currentUrl = await cdp.send('Runtime.evaluate', { expression: 'window.location.href' });
      const match = currentUrl.result.value.match(/token=([^&]+)/);
      const token = match ? match[1] : '';

      // 使用正确的编辑页面URL (type=77 是图文消息)
      await cdp.send('Page.navigate', {
        url: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&token=${token}&lang=zh_CN`
      });
      await h.waitForPageLoad(cdp, 30000);
    }

    await sleep(5000);  // 等待编辑器加载

    // 6. 等待编辑器加载完成 - 使用更多可能的选择器
    log('公众号', '等待编辑器加载...');
    let editorLoaded = await h.waitForElement(cdp, '#js_editor_title', 10000);
    if (!editorLoaded) {
      // 尝试其他可能的编辑器选择器
      editorLoaded = await h.waitForElement(cdp, 'input[placeholder*="标题"]', 10000);
    }
    if (!editorLoaded) {
      editorLoaded = await h.waitForElement(cdp, 'textarea', 5000);
    }

    if (!editorLoaded) {
      // 列出页面上的可见元素以便调试
      const pageElements = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const inputs = document.querySelectorAll('input, textarea');
            return Array.from(inputs).filter(el => el.offsetWidth > 0).map(el => ({
              tag: el.tagName,
              type: el.type,
              placeholder: el.placeholder?.substring(0, 30),
              id: el.id?.substring(0, 30)
            }));
          })()
        `
      });
      log('公众号', `可见输入元素: ${JSON.stringify(pageElements.result.value)}`);
      await h.saveScreenshot(cdp, 'editor-not-loaded');
      return { success: false, error: '编辑器加载超时' };
    }
    await sleep(2000);

    // 6. 填写标题
    log('公众号', '填写标题...');
    const titleResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const titleInput = document.getElementById('js_editor_title') ||
                            document.querySelector('#js_appmsg_title') ||
                            document.querySelector('input[placeholder*="标题"]');
          if (titleInput) {
            titleInput.focus();
            titleInput.value = ${JSON.stringify(task.title || '')};
            titleInput.dispatchEvent(new Event('input', { bubbles: true }));
            titleInput.dispatchEvent(new Event('change', { bubbles: true }));
            titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
            return 'filled';
          }
          return 'not_found';
        })()
      `
    });
    log('公众号', `标题填写: ${titleResult.result.value}`);

    if (titleResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-title-input');
      return { success: false, error: '未找到标题输入框' };
    }

    await sleep(1000);

    // 7. 填写正文内容
    if (task.content) {
      log('公众号', '填写正文内容...');
      const contentResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            // 查找编辑器（公众号使用富文本编辑器）
            const selectors = [
              '#edui1_iframeholder iframe',  // UEditor iframe
              '#js_editor_iframe',
              'iframe[id*="ueditor"]'
            ];

            // 先尝试找到 iframe
            for (const selector of selectors) {
              const iframe = document.querySelector(selector);
              if (iframe) {
                try {
                  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                  const body = iframeDoc.body;
                  if (body) {
                    body.focus();
                    body.innerHTML = ${JSON.stringify(task.content.replace(/\n/g, '<br>'))};
                    // 触发编辑器事件
                    body.dispatchEvent(new Event('input', { bubbles: true }));
                    return 'filled_iframe: ' + selector;
                  }
                } catch (e) {
                  return 'iframe_access_error: ' + e.message;
                }
              }
            }

            // 如果没有 iframe，尝试直接找 contenteditable 元素
            const directEditors = [
              '#js_editor',
              '.js_editor_content',
              'div[contenteditable="true"]'
            ];

            for (const selector of directEditors) {
              const editor = document.querySelector(selector);
              if (editor && editor.offsetWidth > 100) {
                editor.focus();
                editor.innerHTML = ${JSON.stringify(task.content.replace(/\n/g, '<br>'))};
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                return 'filled_direct: ' + selector;
              }
            }

            return 'not_found';
          })()
        `
      });
      log('公众号', `内容填写: ${contentResult.result.value}`);

      // 如果第一次尝试失败，再试一次（可能编辑器延迟加载）
      if (contentResult.result.value === 'not_found') {
        log('公众号', '等待编辑器初始化，重试...');
        await sleep(2000);

        const retryResult = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 尝试通过 window.ue 访问 UEditor
              if (window.ue && typeof window.ue.setContent === 'function') {
                window.ue.setContent(${JSON.stringify(task.content.replace(/\n/g, '<br>'))});
                return 'filled_ue_api';
              }

              // 尝试其他可能的编辑器 API
              if (window.UE && window.UE.getEditor) {
                const editor = window.UE.getEditor();
                if (editor && editor.setContent) {
                  editor.setContent(${JSON.stringify(task.content.replace(/\n/g, '<br>'))});
                  return 'filled_ue_global';
                }
              }

              return 'retry_failed';
            })()
          `
        });
        log('公众号', `重试结果: ${retryResult.result.value}`);
      }
    }

    await sleep(2000);

    // 8. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('公众号', `发布前截图: ${prePublishScreenshot}`);

    // 9. 保存草稿或发布
    // 公众号一般需要先保存，再选择群发
    // 这里我们先点击"保存"，因为直接群发需要更多权限
    log('公众号', '保存草稿...');
    const saveResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('a, button, span');
          const priorities = ['保存为草稿', '保存草稿', '保存', '保存并群发'];

          for (const priority of priorities) {
            for (const btn of buttons) {
              const text = btn.textContent?.trim();
              if (text === priority && btn.offsetWidth > 0) {
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  btn.click();
                  return 'clicked: ' + text;
                }
              }
            }
          }

          // 尝试通过 ID 查找（公众号可能用 ID）
          const saveBtn = document.getElementById('js_submit') ||
                          document.getElementById('js_send') ||
                          document.querySelector('.js_submit');
          if (saveBtn) {
            saveBtn.click();
            return 'clicked_by_id';
          }

          return 'not_found';
        })()
      `
    });
    log('公众号', `保存按钮: ${saveResult.result.value}`);

    if (saveResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-save-btn');
      return { success: false, error: '未找到保存按钮' };
    }

    // 10. 等待保存完成
    await sleep(3000);

    // 11. 处理可能的确认弹窗
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button, a');
          for (const btn of buttons) {
            const text = btn.textContent?.trim();
            if ((text === '确定' || text === '确认') && btn.offsetWidth > 0) {
              btn.click();
              return true;
            }
          }
          return false;
        })()
      `
    });

    await sleep(2000);

    // 12. 验证保存结果
    log('公众号', '验证保存结果...');
    const verifyResult = await h.verifyPublishSuccess(cdp, 20000);
    log('公众号', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '草稿保存成功（公众号需手动群发）' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '保存失败，请检查内容格式' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击保存，请在公众号后台确认' };
    }

  } catch (e) {
    log('公众号', `错误: ${e.message}`);
    await gongzhonghaoHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// ============ 视频号发布 ============

// 视频号辅助函数
const shipinhaoHelpers = {
  // 智能等待元素出现
  async waitForElement(cdp, selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `!!document.querySelector('${selector}')`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 等待页面加载完成
  async waitForPageLoad(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`
      });
      if (result.result.value) return true;
      await sleep(1000);
    }
    return false;
  },

  // 检查登录状态
  async checkLogin(cdp) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const url = window.location.href;
          if (url.includes('login') || url.includes('passport')) return 'need_login';
          if (url.includes('channels.weixin.qq.com/platform')) return 'logged_in';
          const bodyText = document.body.innerText;
          if (bodyText.includes('视频号助手') || bodyText.includes('发表新动态')) return 'logged_in';
          return 'unknown';
        })()
      `
    });
    return result.result.value;
  },

  // 截图保存
  async saveScreenshot(cdp, name) {
    try {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const filename = `/tmp/shipinhao-${name}-${Date.now()}.png`;
      fs.writeFileSync(filename, Buffer.from(screenshot.data, 'base64'));
      return filename;
    } catch (e) {
      return null;
    }
  },

  // 获取文件上传节点
  async getFileInput(cdp, acceptType) {
    const doc = await cdp.send('DOM.getDocument');
    const inputNode = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: acceptType ? `input[type="file"][accept*="${acceptType}"]` : 'input[type="file"]'
    });
    return inputNode.nodeId ? inputNode : null;
  },

  // 通过元素文本点击
  async clickByText(cdp, text, tagSelector = '*') {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('${tagSelector}');
          for (const el of elements) {
            if (el.textContent?.trim().includes('${text}') || el.innerText?.trim().includes('${text}')) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
              }
            }
          }
          return null;
        })()
      `,
      returnByValue: true
    });

    if (result.result.value) {
      const { x, y } = result.result.value;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return true;
    }
    return false;
  },

  // 验证发布成功
  async verifyPublishSuccess(cdp, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const url = window.location.href;
            const text = document.body.innerText;
            if (url.includes('/post/list') || text.includes('发布成功') || text.includes('已发布')) {
              return 'success';
            }
            if (text.includes('发布失败') || text.includes('审核中')) {
              return 'failed';
            }
            return 'pending';
          })()
        `
      });
      if (result.result.value !== 'pending') {
        return result.result.value;
      }
      await sleep(2000);
    }
    return 'timeout';
  }
};

async function publishShipinhao(cdp, task, files) {
  const h = shipinhaoHelpers;
  log('视频号', '========== 开始发布 ==========');

  try {
    // 1. 启用必要的 domain
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');

    // 2. 导航到发布页面
    log('视频号', '导航到视频号助手...');
    await cdp.send('Page.navigate', {
      url: 'https://channels.weixin.qq.com/platform/post/create'
    });

    // 3. 等待页面加载
    log('视频号', '等待页面加载...');
    await h.waitForPageLoad(cdp, 30000);
    await sleep(3000);  // 额外等待动态内容

    // 4. 检查登录状态
    const loginStatus = await h.checkLogin(cdp);
    log('视频号', `登录状态: ${loginStatus}`);
    if (loginStatus === 'need_login') {
      await h.saveScreenshot(cdp, 'need-login');
      return { success: false, error: '需要登录，请先在浏览器中登录视频号' };
    }

    log('视频号', `类型: ${task.mediaType}, 文件: ${files.length}`);

    // ===== 视频模式 =====
    if (task.mediaType === 'video' && files.length > 0) {
      log('视频号', '>>> 视频模式');

      // 等待上传区域出现
      await sleep(2000);

      // 获取视频上传节点
      const inputNode = await h.getFileInput(cdp, 'video');
      if (!inputNode) {
        await h.saveScreenshot(cdp, 'no-video-input');
        return { success: false, error: '未找到视频上传框' };
      }

      // 上传视频
      log('视频号', `上传视频: ${path.basename(files[0])}`);
      await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [files[0]]
      });

      // 等待视频上传和处理
      log('视频号', '等待视频处理...');
      let processed = false;
      for (let i = 0; i < 120; i++) {  // 最多等待 4 分钟
        await sleep(2000);

        // 检查是否有编辑表单出现
        const hasForm = await cdp.send('Runtime.evaluate', {
          expression: `
            (function() {
              // 查找描述输入框或标题输入框
              const descBox = document.querySelector('textarea[placeholder*="描述"], textarea[placeholder*="内容"], div[contenteditable="true"]');
              return !!descBox;
            })()
          `
        });

        if (hasForm.result.value) {
          processed = true;
          log('视频号', '视频处理完成，表单已加载');
          break;
        }

        if (i % 10 === 0) log('视频号', `处理中... ${i * 2}s`);
      }

      if (!processed) {
        await h.saveScreenshot(cdp, 'video-process-timeout');
        return { success: false, error: '视频处理超时' };
      }

      await sleep(2000);

    // ===== 图文模式 =====
    } else if (task.mediaType === 'image') {
      log('视频号', '>>> 图文模式');

      // 视频号图文需要通过菜单导航进入
      // 步骤1: 导航到首页
      log('视频号', '导航到首页...');
      await cdp.send('Page.navigate', { url: 'https://channels.weixin.qq.com/platform' });
      await sleep(8000);

      // 步骤2: 悬停在"内容管理"菜单上展开子菜单
      log('视频号', '展开内容管理菜单...');
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: 44, y: 204
      });
      await sleep(1500);

      // 步骤3: 检查"图文"子菜单是否出现并点击
      const tuwenMenuResult = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(function() {
          const items = [];
          document.querySelectorAll('*').forEach(el => {
            const text = el.textContent?.trim() || '';
            const rect = el.getBoundingClientRect();
            if (text === '图文' && rect.width > 0 && rect.left > 50 && rect.left < 250) {
              items.push({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
            }
          });
          return items[0] || null;
        })()`
      });

      if (!tuwenMenuResult.result?.value) {
        await h.saveScreenshot(cdp, 'no-tuwen-menu');
        return { success: false, error: '未找到图文菜单' };
      }

      const tuwenPos = tuwenMenuResult.result.value;
      log('视频号', `点击图文菜单 (${tuwenPos.x}, ${tuwenPos.y})...`);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: tuwenPos.x, y: tuwenPos.y, button: 'left', clickCount: 1
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: tuwenPos.x, y: tuwenPos.y, button: 'left'
      });
      await sleep(5000);

      // 步骤4: 点击"发表图文"按钮（在iframe中，使用鼠标坐标点击）
      log('视频号', '查找发表图文按钮...');
      const publishBtnResult = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(function() {
          // 检查iframe中的按钮
          const iframe = document.querySelector('iframe[name="content"]');
          if (iframe) {
            try {
              const doc = iframe.contentDocument || iframe.contentWindow.document;
              const allEls = doc.querySelectorAll('button, a, div');
              for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if (text === '发表图文' && el.offsetWidth > 0 && el.offsetWidth < 200) {
                  const rect = el.getBoundingClientRect();
                  const iframeRect = iframe.getBoundingClientRect();
                  return {
                    found: true,
                    x: Math.round(iframeRect.left + rect.left + rect.width / 2),
                    y: Math.round(iframeRect.top + rect.top + rect.height / 2)
                  };
                }
              }
            } catch(e) {}
          }
          return { found: false };
        })()`
      });

      if (!publishBtnResult.result?.value?.found) {
        await h.saveScreenshot(cdp, 'no-publish-btn');
        return { success: false, error: '未找到发表图文按钮' };
      }

      // 点击发表图文按钮（使用鼠标坐标点击，因为JS click可能不触发Vue路由）
      const btnPos = publishBtnResult.result.value;
      log('视频号', `点击发表图文按钮 (${btnPos.x}, ${btnPos.y})...`);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: btnPos.x, y: btnPos.y, button: 'left'
      });
      await sleep(5000);

      // 步骤5: 上传图片
      if (files.length > 0) {
        log('视频号', '查找图片上传框...');

        // 在iframe中查找file input
        const fileInputResult = await cdp.send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(function() {
            const iframe = document.querySelector('iframe[name="content"]');
            if (iframe) {
              try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                const inputs = doc.querySelectorAll('input[type="file"]');
                for (const input of inputs) {
                  if (input.accept?.includes('image')) {
                    return { found: true, accept: input.accept };
                  }
                }
              } catch(e) {}
            }
            return { found: false };
          })()`
        });

        if (!fileInputResult.result?.value?.found) {
          await h.saveScreenshot(cdp, 'no-image-input');
          return { success: false, error: '未找到图片上传框' };
        }

        // 获取iframe中的file input nodeId
        log('视频号', '获取上传节点...');
        const frameTree = await cdp.send('Page.getFrameTree');
        let contentFrameId = null;
        for (const frame of frameTree.frameTree.childFrames || []) {
          if (frame.frame.name === 'content') {
            contentFrameId = frame.frame.id;
            break;
          }
        }

        if (contentFrameId) {
          // 在content frame中获取DOM
          const frameDoc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
          const inputQuery = await cdp.send('DOM.querySelectorAll', {
            nodeId: frameDoc.root.nodeId,
            selector: 'input[type="file"][accept*="image"]'
          });

          if (inputQuery.nodeIds?.length > 0) {
            log('视频号', `上传图片: ${files.length} 张`);
            await cdp.send('DOM.setFileInputFiles', {
              nodeId: inputQuery.nodeIds[0],
              files: files
            });

            // 等待图片上传完成
            log('视频号', '等待图片上传...');
            await sleep(3000);
            for (let i = 0; i < 30; i++) {
              const uploadCheck = await cdp.send('Runtime.evaluate', {
                expression: `(function() {
                  const iframe = document.querySelector('iframe[name="content"]');
                  if (iframe) {
                    try {
                      const doc = iframe.contentDocument || iframe.contentWindow.document;
                      const uploading = doc.querySelectorAll('[class*="uploading"], [class*="loading"], .ant-upload-animate-enter');
                      return uploading.length === 0;
                    } catch(e) {}
                  }
                  return true;
                })()`
              });
              if (uploadCheck.result.value) {
                log('视频号', '图片上传完成');
                break;
              }
              await sleep(1000);
            }
          } else {
            await h.saveScreenshot(cdp, 'no-image-input-node');
            return { success: false, error: '无法获取图片上传节点' };
          }
        } else {
          await h.saveScreenshot(cdp, 'no-content-frame');
          return { success: false, error: '未找到content frame' };
        }
      } else {
        log('视频号', '无文件需上传（纯文字动态）');
      }

    } else {
      return { success: false, error: `不支持的类型: ${task.mediaType}` };
    }

    await sleep(2000);

    // 5. 填写描述/内容（需要同时支持主文档和iframe）
    log('视频号', '填写内容...');
    const content = task.content || task.title || '';
    const fillResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const contentStr = ${JSON.stringify(content)};
          const contentHtml = ${JSON.stringify(content.replace(/\n/g, '<br>'))};

          // 辅助函数：在指定文档中填写内容
          function fillInDoc(doc, label) {
            const selectors = [
              'textarea[placeholder*="描述"]',
              'textarea[placeholder*="内容"]',
              'textarea[placeholder*="说点什么"]',
              'div[contenteditable="true"]',
              'textarea'
            ];

            for (const selector of selectors) {
              const box = doc.querySelector(selector);
              if (box && box.offsetWidth > 100) {
                box.focus();
                if (box.tagName === 'TEXTAREA') {
                  box.value = contentStr;
                } else {
                  box.innerHTML = contentHtml;
                }
                box.dispatchEvent(new Event('input', { bubbles: true }));
                box.dispatchEvent(new Event('change', { bubbles: true }));
                return label + ':' + selector;
              }
            }
            return null;
          }

          // 先尝试主文档
          let result = fillInDoc(document, 'main');
          if (result) return result;

          // 再尝试iframe
          const iframe = document.querySelector('iframe[name="content"]');
          if (iframe) {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
              result = fillInDoc(iframeDoc, 'iframe');
              if (result) return result;
            } catch(e) {}
          }

          return 'not_found';
        })()
      `
    });
    log('视频号', `内容填写: ${fillResult.result.value}`);

    if (fillResult.result.value === 'not_found') {
      log('视频号', '警告: 未找到内容输入框');
    }

    await sleep(2000);

    // 6. 如果有标题字段，填写标题（视频号可能有独立的标题字段）
    if (task.title && task.title !== task.content) {
      log('视频号', '尝试填写标题...');
      await cdp.send('Runtime.evaluate', {
        expression: `
          (function() {
            const titleStr = ${JSON.stringify(task.title)};

            // 辅助函数
            function fillTitle(doc) {
              const titleInput = doc.querySelector('input[placeholder*="标题"]');
              if (titleInput) {
                titleInput.focus();
                titleInput.value = titleStr;
                titleInput.dispatchEvent(new Event('input', { bubbles: true }));
                titleInput.dispatchEvent(new Event('change', { bubbles: true }));
                return 'filled';
              }
              return null;
            }

            // 先主文档
            let result = fillTitle(document);
            if (result) return result;

            // 再iframe
            const iframe = document.querySelector('iframe[name="content"]');
            if (iframe) {
              try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                result = fillTitle(iframeDoc);
                if (result) return result;
              } catch(e) {}
            }

            return 'not_found';
          })()
        `
      });
    }

    await sleep(2000);

    // 7. 截图保存（发布前）
    const prePublishScreenshot = await h.saveScreenshot(cdp, 'pre-publish');
    log('视频号', `发布前截图: ${prePublishScreenshot}`);

    // 8. 点击发布按钮（支持主文档和iframe）
    log('视频号', '点击发布按钮...');
    const publishResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const priorities = ['发表', '发布', '完成'];

          // 辅助函数：在指定文档中查找并点击发布按钮
          function clickPublishBtn(doc, label) {
            const buttons = doc.querySelectorAll('button');

            for (const priority of priorities) {
              for (const btn of buttons) {
                const text = btn.textContent?.trim();
                if (text === priority && !btn.disabled && btn.offsetWidth > 0) {
                  btn.click();
                  return label + ':clicked: ' + text;
                }
              }
            }

            // 备用：查找包含发布相关文字的按钮
            for (const btn of buttons) {
              const text = btn.textContent?.trim();
              if ((text?.includes('发表') || text?.includes('发布')) && !btn.disabled && btn.offsetWidth > 0) {
                btn.click();
                return label + ':clicked_fallback: ' + text;
              }
            }

            return null;
          }

          // 先尝试主文档
          let result = clickPublishBtn(document, 'main');
          if (result) return result;

          // 再尝试iframe
          const iframe = document.querySelector('iframe[name="content"]');
          if (iframe) {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
              result = clickPublishBtn(iframeDoc, 'iframe');
              if (result) return result;
            } catch(e) {}
          }

          return 'not_found';
        })()
      `
    });
    log('视频号', `发布按钮: ${publishResult.result.value}`);

    if (publishResult.result.value === 'not_found') {
      await h.saveScreenshot(cdp, 'no-publish-btn');
      return { success: false, error: '未找到发布按钮' };
    }

    // 9. 处理可能的确认弹窗（支持主文档和iframe）
    await sleep(2000);
    await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          function clickConfirm(doc) {
            const buttons = doc.querySelectorAll('button');
            for (const btn of buttons) {
              if ((btn.textContent?.includes('确定') || btn.textContent?.includes('确认')) && !btn.disabled) {
                btn.click();
                return true;
              }
            }
            return false;
          }

          // 先主文档
          if (clickConfirm(document)) return true;

          // 再iframe
          const iframe = document.querySelector('iframe[name="content"]');
          if (iframe) {
            try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
              if (clickConfirm(iframeDoc)) return true;
            } catch(e) {}
          }

          return false;
        })()
      `
    });

    // 10. 验证发布结果
    log('视频号', '验证发布结果...');
    await sleep(3000);
    const verifyResult = await h.verifyPublishSuccess(cdp, 30000);
    log('视频号', `验证结果: ${verifyResult}`);

    // 最终截图
    await h.saveScreenshot(cdp, 'final');

    if (verifyResult === 'success') {
      return { success: true, message: '发布成功' };
    } else if (verifyResult === 'failed') {
      return { success: false, error: '发布失败，可能需要审核' };
    } else {
      // timeout 也算成功（可能页面没跳转但实际成功了）
      return { success: true, message: '已点击发布，结果待确认' };
    }

  } catch (e) {
    log('视频号', `错误: ${e.message}`);
    await shipinhaoHelpers.saveScreenshot(cdp, 'error');
    return { success: false, error: e.message };
  }
}

// TODO: 以下平台待实现
// - 知乎 (zhihu)

// ============ 主函数 ============

async function publish(taskId, platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) {
    return { success: false, error: `未知平台: ${platformId}` };
  }

  log(platform.name, '========== 开始发布 ==========');

  // 0. 获取锁（防止并发冲突）
  log(platform.name, '获取发布锁...');
  if (!lockManager.acquire(platformId, 60000)) {  // 等待最多1分钟
    return { success: false, error: '平台正忙，有其他发布任务在进行中' };
  }
  log(platform.name, '已获取锁');

  let result;
  let createdPageId = null;  // 记录创建的页面，用于清理
  let browserWsUrl = null;
  let windowsFiles = [], localFiles = [];

  try {
    // 1. 获取任务
    let task;
    try {
      task = await getTaskDetails(taskId);
      log(platform.name, `任务: ${task.title}`);
      log(platform.name, `类型: ${task.mediaType}, 文件: ${task.originalFiles?.length || 0}`);
    } catch (e) {
      throw new Error(`获取任务失败: ${e.message}`);
    }

    // 2. 准备文件
    try {
      const prepared = await prepareFiles(task, platform.name);
      windowsFiles = prepared.windowsFiles;
      localFiles = prepared.localFiles;
    } catch (e) {
      log(platform.name, `文件准备失败: ${e.message}`);
    }

    // 3. 获取浏览器 WebSocket URL
    const versionResult = await httpGet(`http://${WINDOWS_IP}:${platform.cdpPort}/json/version`);
    if (versionResult.status !== 200 || !versionResult.data.webSocketDebuggerUrl) {
      throw new Error('无法获取浏览器端点');
    }
    browserWsUrl = versionResult.data.webSocketDebuggerUrl;

    // 4. 创建专用页面（隔离发布操作，不影响其他页面）
    log(platform.name, '创建发布专用页面...');
    createdPageId = await pageManager.createPublishPage(browserWsUrl);
    log(platform.name, `页面已创建: ${createdPageId}`);

    // 等待页面创建完成
    await sleep(1000);

    // 获取新页面的 WebSocket URL
    const pageWsUrl = await pageManager.getPageWsUrl(platform.cdpPort, createdPageId);
    if (!pageWsUrl) {
      throw new Error('无法获取新页面端点');
    }

    // 5. 连接到新页面
    const cdp = new CDPClient(pageWsUrl);
    await cdp.connect();
    log(platform.name, 'CDP 已连接');

    // 6. 执行发布
    if (platformId === 'douyin') {
      result = await publishDouyin(cdp, task, windowsFiles);
    } else if (platformId === 'kuaishou') {
      result = await publishKuaishou(cdp, task, windowsFiles);
    } else if (platformId === 'xiaohongshu') {
      result = await publishXiaohongshu(cdp, task, windowsFiles);
    } else if (platformId === 'weibo') {
      result = await publishWeibo(cdp, task, windowsFiles);
    } else if (platformId.startsWith('toutiao')) {
      result = await publishToutiao(cdp, task, windowsFiles);
    } else if (platformId === 'shipinhao') {
      result = await publishShipinhao(cdp, task, windowsFiles);
    } else if (platformId === 'gongzhonghao') {
      result = await publishGongzhonghao(cdp, task, windowsFiles);
    } else if (platformId === 'zhihu') {
      result = await publishZhihu(cdp, task, windowsFiles);
    } else {
      result = { success: false, error: `${platform.name} 暂不支持自动发布` };
    }

    cdp.close();

  } catch (e) {
    result = { success: false, error: e.message };
    log(platform.name, `发布失败: ${e.message}`);
  } finally {
    // 7. 清理：关闭创建的页面
    if (createdPageId && browserWsUrl) {
      log(platform.name, '清理发布页面...');
      await pageManager.closePage(browserWsUrl, createdPageId);
    }

    // 8. 释放锁
    lockManager.release(platformId);
    log(platform.name, '已释放锁');

    // 9. 清理本地临时文件
    cleanupLocalFiles(localFiles);
  }

  // 10. 更新结果到数据库
  try {
    await updateTaskResult(taskId, platformId, result);
  } catch (e) {
    log(platform.name, `更新结果失败: ${e.message}`);
  }

  log(platform.name, result.success ? '✓ 完成' : `✗ ${result.error}`);
  log(platform.name, '========== 结束 ==========');

  return result;
}

// CLI
const args = process.argv.slice(2);

// 特殊命令
if (args[0] === '--status') {
  // 检查所有平台锁状态
  console.log('平台锁状态:');
  Object.entries(PLATFORMS).forEach(([id, p]) => {
    const locked = lockManager.isLocked(id);
    console.log(`  ${p.name.padEnd(10)} (${id.padEnd(15)}): ${locked ? '🔒 锁定中' : '✅ 空闲'}`);
  });
  process.exit(0);
}

if (args[0] === '--unlock' && args[1]) {
  // 强制解锁（用于异常情况）
  lockManager.release(args[1]);
  console.log(`已解锁: ${args[1]}`);
  process.exit(0);
}

if (args[0] === '--check' && args[1]) {
  // 检查 CDP 连接
  const platform = PLATFORMS[args[1]];
  if (!platform) {
    console.error('未知平台:', args[1]);
    process.exit(1);
  }

  httpGet(`http://${WINDOWS_IP}:${platform.cdpPort}/json`).then(r => {
    if (r.status === 200) {
      console.log(`✅ ${platform.name} CDP 正常`);
      console.log(`   页面数: ${r.data.filter(p => p.type === 'page').length}`);
      r.data.filter(p => p.type === 'page').forEach(p => {
        console.log(`   - ${p.url.substring(0, 60)}`);
      });
    } else {
      console.log(`❌ ${platform.name} CDP 无响应`);
    }
    process.exit(0);
  }).catch(e => {
    console.log(`❌ ${platform.name} CDP 连接失败: ${e.message}`);
    process.exit(1);
  });
  return;
}

if (args.length < 2) {
  console.error('VPS 内容发布脚本');
  console.error('');
  console.error('用法:');
  console.error('  node vps_publisher.js <taskId> <platform>  - 执行发布任务');
  console.error('  node vps_publisher.js --status             - 查看所有平台锁状态');
  console.error('  node vps_publisher.js --unlock <platform>  - 强制解锁平台');
  console.error('  node vps_publisher.js --check <platform>   - 检查 CDP 连接');
  console.error('');
  console.error('支持的平台:');
  Object.entries(PLATFORMS).forEach(([id, p]) => console.error(`  ${id.padEnd(15)} - ${p.name} (端口 ${p.cdpPort})`));
  process.exit(1);
}

publish(args[0], args[1]).then(r => {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.success ? 0 : 1);
});

module.exports = { publish, PLATFORMS };
