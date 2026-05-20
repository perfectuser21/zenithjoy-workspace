#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 知乎专栏文章发布脚本（API 方案）
 *
 * 技术方案：CDP 连接 + in-browser fetch 调用知乎内部 API
 *
 * 对比旧方案 (publish-zhihu-article.cjs)：
 *   旧方案：CDP 控制浏览器 UI（点击、填表）→ 脆弱、受页面改版影响
 *   新方案：CDP 仅用于连接已登录会话 → in-browser fetch 调用知乎 API → 稳定快速
 *
 * 为什么用 in-browser fetch 而非 Cookie 提取：
 *   知乎使用复杂 CSRF 签名体系（x-zse-93/x-zse-96），难以在外部计算。
 *   in-browser fetch 自动携带所有 Cookie 和 CSRF 头，无需手动处理。
 *
 * 发布流程：
 *   1. CDP 连接 Windows Chrome (19229)
 *   2. 导航到 https://zhuanlan.zhihu.com 确认已登录
 *   3. 通过 Runtime.evaluate 在浏览器中调用 fetch 创建文章草稿
 *   4. 上传封面图（可选）
 *   5. 发布草稿 → 得到文章 ID
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-zhihu-api.cjs --content /path/to/article-1/
 *
 * --dry-run 模式（不实际连接 CDP，仅打印参数）：
 *   node publish-zhihu-api.cjs --content /path/to/article-1/ --dry-run
 *
 * 内容目录结构：
 *   title.txt    - 标题（必需，100字以内）
 *   content.txt  - 正文（必需，纯文本或 HTML）
 *   cover.jpg    - 封面图（可选，支持 .jpg/.jpeg/.png）
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// 配置
// ============================================================

const CDP_PORT = 19229;
const WINDOWS_IP = '100.97.242.124';
const ZHIHU_WRITE_URL = 'https://zhuanlan.zhihu.com/write';

/**
 * 知乎内部 API 端点
 *
 * NOTE: 若接口返回 4xx，请通过 Chrome DevTools Network 面板捕获真实端点：
 *       在 Windows Chrome 打开知乎专栏，发布文章时记录实际请求 URL 并更新此处。
 */
const ZHIHU_CREATE_API = 'https://zhuanlan.zhihu.com/api2/articles';
const ZHIHU_IMAGE_UPLOAD_API = 'https://api.zhihu.com/images';

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 检测当前 URL 是否为登录失效页面
 *
 * @param {string} url - 当前页面 URL
 * @returns {boolean}
 */
function isLoginError(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('/signin') ||
    url.includes('/signup') ||
    url.includes('passport.zhihu.com/login') ||
    url.includes('/login')
  );
}

/**
 * 解析知乎 API 响应
 *
 * 知乎 API 成功通常返回：
 *   { id: 12345678, title: "...", ... }  — 创建/更新成功
 *   { error: { message: "..." } }        — 失败
 *   HTTP 4xx/5xx                          — 失败
 *
 * @param {number} statusCode
 * @param {string} body
 * @returns {{ ok: boolean, data: any, errorMsg: string|null, articleId: string|null }}
 */
function parseZhihuResponse(statusCode, body) {
  if (statusCode >= 400) {
    let errorDetail = body ? body.slice(0, 200) : `HTTP ${statusCode}`;
    try {
      const parsed = JSON.parse(body);
      errorDetail = parsed?.error?.message || parsed?.message || errorDetail;
    } catch {
      // 保留原始 body
    }
    return { ok: false, data: null, errorMsg: `HTTP ${statusCode}: ${errorDetail}`, articleId: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, data: null, errorMsg: `响应解析失败: ${body.slice(0, 200)}`, articleId: null };
  }

  if (parsed?.error) {
    const errorMsg = parsed.error?.message || JSON.stringify(parsed.error).slice(0, 200);
    return { ok: false, data: parsed, errorMsg, articleId: null };
  }

  const articleId = parsed?.id ? String(parsed.id) : null;
  return { ok: true, data: parsed, errorMsg: null, articleId };
}

/**
 * 将普通文本转换为知乎支持的 HTML 格式
 *
 * @param {string} text - 纯文本内容
 * @returns {string} HTML 格式正文
 */
function textToZhihuHtml(text) {
  if (!text || typeof text !== 'string') return '<p></p>';
  if (text.includes('<p>') || text.includes('<div>') || text.includes('<h')) {
    return text;
  }
  return (
    text
      .split(/\n{2,}/)
      .map(para => para.trim())
      .filter(para => para.length > 0)
      .map(para => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
      .join('\n') || '<p></p>'
  );
}

/**
 * 在内容目录中查找封面图
 *
 * @param {string} contentDir - 内容目录路径
 * @param {Object} fsModule - fs 模块（支持 mock）
 * @returns {string|null} 封面图路径或 null
 */
function findCoverImage(contentDir, fsModule) {
  const fsImpl = fsModule || fs;
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = path.join(contentDir, `cover.${ext}`);
    if (fsImpl.existsSync(p)) return p;
  }
  return null;
}

// ============================================================
// 工具函数
// ============================================================

async function withRetry(fn, maxRetries, delayMs) {
  const retries = maxRetries || 3;
  const delay = delayMs || 2000;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes('[NO_RETRY]')) throw err;
      if (attempt < retries) {
        _log(`   重试 ${attempt}/${retries - 1}...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ============================================================
// CDP 客户端（内联版本，避免跨 skill 依赖）
// ============================================================

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.callbacks = {};
  }

  connect() {
    const WebSocket = require('ws');
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

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const timer = setTimeout(() => {
        if (this.callbacks[id]) {
          delete this.callbacks[id];
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 60000);
      this.callbacks[id] = msg => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      };
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
// CDP 连接工具
// ============================================================

function getCDPPages(ip, port) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://${ip}:${port}/json`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`CDP 响应解析失败: ${e.message}`));
          }
        });
      })
      .on('error', err =>
        reject(
          new Error(
            `[CDP_ERROR] 无法连接 CDP (${ip}:${port}): ${err.message}\n` +
              `排查：curl http://${ip}:${port}/json`
          )
        )
      );
  });
}

async function connectToBestTab(pages) {
  const zhihuTab = pages.find(p =>
    p.type === 'page' && (p.url || '').includes('zhihu.com')
  );
  const anyTab = pages.find(p => p.type === 'page');
  const tab = zhihuTab || anyTab;

  if (!tab || !tab.webSocketDebuggerUrl) {
    throw new Error(
      '[CDP_ERROR] 未找到可用的 Chrome 标签页。\n' +
        '请确认 Windows Chrome 已启动并开启 CDP 调试。'
    );
  }

  _log(`   连接标签页: ${tab.url || '(空页)'}`);
  const cdp = new CDPClient(tab.webSocketDebuggerUrl);
  await cdp.connect();
  return cdp;
}

// ============================================================
// 核心业务：in-browser fetch 调用知乎 API
// ============================================================

async function browserFetch(cdp, url, method, body) {
  const bodyJson = body ? JSON.stringify(body) : null;
  const expression = `
    (async function() {
      try {
        const opts = {
          method: ${JSON.stringify(method)},
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          ${bodyJson ? `body: ${JSON.stringify(bodyJson)},` : ''}
        };
        const resp = await fetch(${JSON.stringify(url)}, opts);
        const text = await resp.text();
        return JSON.stringify({ status: resp.status, body: text });
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
  });

  const value = result?.result?.value;
  if (!value) throw new Error('浏览器 fetch 返回空结果');

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`浏览器 fetch 结果解析失败: ${value.slice(0, 200)}`);
  }

  if (parsed.error) throw new Error(`浏览器 fetch 执行错误: ${parsed.error}`);
  return { statusCode: parsed.status, body: parsed.body };
}

async function ensureZhihuSession(cdp) {
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const urlResult = await cdp.send('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  });
  const currentUrl = urlResult?.result?.value || '';
  _log(`   当前页面: ${currentUrl}`);

  if (!currentUrl.includes('zhihu.com')) {
    _log('   导航到知乎专栏...');
    await cdp.send('Page.navigate', { url: ZHIHU_WRITE_URL });
    await new Promise(r => setTimeout(r, 3000));

    const newUrlResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    const newUrl = newUrlResult?.result?.value || '';

    if (isLoginError(newUrl)) {
      throw new Error(
        `[NO_RETRY][SESSION_EXPIRED] 知乎会话失效，请在 Windows Chrome 重新登录。\n` +
          `  当前 URL: ${newUrl}\n` +
          `  CDP 端口: ${CDP_PORT} (Windows: ${WINDOWS_IP})`
      );
    }
  } else if (isLoginError(currentUrl)) {
    throw new Error(
      `[NO_RETRY][SESSION_EXPIRED] 知乎会话失效，请在 Windows Chrome 重新登录。\n` +
        `  当前 URL: ${currentUrl}`
    );
  }

  _log('   ✅ 知乎会话有效');
}

async function uploadCoverImage(cdp, coverPath) {
  if (!coverPath || !fs.existsSync(coverPath)) return null;

  _log(`   上传封面图: ${path.basename(coverPath)}`);

  const imageBuffer = fs.readFileSync(coverPath);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(coverPath).toLowerCase().replace('.', '');
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
  const filename = path.basename(coverPath);

  const expression = `
    (async function() {
      try {
        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: ${JSON.stringify(mimeType)} });
        const form = new FormData();
        form.append('image', blob, ${JSON.stringify(filename)});
        const resp = await fetch(${JSON.stringify(ZHIHU_IMAGE_UPLOAD_API)}, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        const data = await resp.json();
        return JSON.stringify({ status: resp.status, data });
      } catch(e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `;

  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 60000,
  });

  const value = result?.result?.value;
  if (!value) { console.warn('   ⚠️  封面图上传返回空，跳过'); return null; }

  let parsed;
  try { parsed = JSON.parse(value); } catch { console.warn('   ⚠️  封面图上传结果解析失败，跳过'); return null; }

  if (parsed.error || parsed.status >= 400) {
    console.warn(`   ⚠️  封面图上传失败 (${parsed.error || 'HTTP ' + parsed.status})，跳过`);
    return null;
  }

  const data = parsed.data || {};
  const token = data.token || data.id || data.image_id || null;
  _log(`   ✅ 封面图上传成功${token ? ': token=' + token : ''}`);
  return token;
}

async function createAndPublishArticle(cdp, article) {
  const { title, content, coverToken } = article;
  const htmlContent = textToZhihuHtml(content);

  _log('   调用知乎 API 创建文章...');
  const createBody = { title, content: htmlContent, table_of_contents: false, draft: false };
  if (coverToken) createBody.image_url = coverToken;

  const createResp = await browserFetch(cdp, ZHIHU_CREATE_API, 'POST', createBody);
  _log(`   API 响应: HTTP ${createResp.statusCode}`);

  const { ok, errorMsg, articleId } = parseZhihuResponse(
    createResp.statusCode,
    createResp.body
  );

  if (!ok) {
    if (createResp.statusCode === 403 || createResp.statusCode === 401) {
      throw new Error(
        `[NO_RETRY][SESSION_EXPIRED] 发布失败（登录失效）: ${errorMsg}\n` +
          `  请在 Windows Chrome 重新登录知乎`
      );
    }
    throw new Error(`发布文章失败: ${errorMsg}`);
  }

  _log(`   ✅ 文章已发布，ID: ${articleId}`);
  return articleId;
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const contentIdx = args.indexOf('--content');
  if (contentIdx === -1 || !args[contentIdx + 1]) {
    console.error('用法: node publish-zhihu-api.cjs --content /path/to/article-dir/ [--dry-run]');
    process.exit(1);
  }
  const contentDir = args[contentIdx + 1].replace(/\/+$/, '');

  const titleFile = path.join(contentDir, 'title.txt');
  const contentFile = path.join(contentDir, 'content.txt');

  if (!fs.existsSync(titleFile)) { console.error(`❌ 缺少 title.txt: ${titleFile}`); process.exit(1); }
  if (!fs.existsSync(contentFile)) { console.error(`❌ 缺少 content.txt: ${contentFile}`); process.exit(1); }

  const title = fs.readFileSync(titleFile, 'utf8').trim();
  const content = fs.readFileSync(contentFile, 'utf8').trim();
  const coverPath = findCoverImage(contentDir);

  _log('========================================');
  _log(' 知乎文章发布（API 方案）');
  _log('========================================');
  _log(`标题: ${title.slice(0, 50)}${title.length > 50 ? '...' : ''}`);
  _log(`正文: ${content.length} 字`);
  _log(`封面: ${coverPath ? path.basename(coverPath) : '（无）'}`);
  _log(`模式: ${isDryRun ? '🔍 dry-run（不实际发布）' : '🚀 生产发布'}`);
  _log('');

  if (isDryRun) {
    _log('✅ dry-run 完成，参数验证通过');
    _log(`   将调用: POST ${ZHIHU_CREATE_API}`);
    _log(`   CDP 端点: ${WINDOWS_IP}:${CDP_PORT}`);
    return;
  }

  _log(`连接 Windows Chrome CDP (${WINDOWS_IP}:${CDP_PORT})...`);
  const pages = await withRetry(() => getCDPPages(WINDOWS_IP, CDP_PORT), 3, 2000);
  _log(`   发现 ${pages.length} 个标签页`);

  const cdp = await connectToBestTab(pages);
  try {
    _log('');
    _log('Step 1: 检查知乎会话...');
    await ensureZhihuSession(cdp);

    let coverToken = null;
    if (coverPath) {
      _log('');
      _log('Step 2: 上传封面图...');
      coverToken = await uploadCoverImage(cdp, coverPath);
    }

    _log('');
    _log('Step 3: 发布文章...');
    const articleId = await createAndPublishArticle(cdp, { title, content, coverToken });

    _log('');
    _log('========================================');
    _log(' ✅ 知乎文章发布成功！');
    _log(`    文章 ID: ${articleId}`);
    if (articleId) _log(`    文章链接: https://zhuanlan.zhihu.com/p/${articleId}`);
    _log('========================================');
  } finally {
    cdp.close();
  }
}

// ============================================================
// 导出（供单元测试）
// ============================================================

module.exports = {
  isLoginError,
  parseZhihuResponse,
  textToZhihuHtml,
  findCoverImage,
};

if (require.main === module) {
  main().catch(err => {
    if (err.message && err.message.includes('[SESSION_EXPIRED]')) {
      console.error('\n❌ 登录失效:', err.message);
      process.exit(2);
    }
    if (err.message && err.message.includes('[CDP_ERROR]')) {
      console.error('\n❌ CDP 连接失败:', err.message);
      process.exit(3);
    }
    console.error('\n❌ 发布失败:', err.message);
    process.exit(1);
  });
}
