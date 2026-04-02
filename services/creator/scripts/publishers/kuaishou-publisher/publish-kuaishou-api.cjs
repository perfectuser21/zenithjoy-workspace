const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 快手图文发布脚本（新 API 方案）
 *
 * 技术方案：CDP 提取 Cookie → HTTP API 直接调用
 *
 * 对比旧方案 (publish-kuaishou-image.cjs)：
 *   旧方案：CDP 控制浏览器 UI（点击、填表、文件 input）→ 脆弱、受页面改版影响
 *   新方案：CDP 仅用于提取 Cookie → HTTP 直接调用创作者中心 API → 稳定、快速
 *
 * 发布流程：
 *   1. CDP 连接 Windows Chrome → 提取快手创作者中心 Cookie
 *   2. 通过 REST API 获取图片上传 Token
 *   3. 逐张上传图片 → 收集 photoId / key
 *   4. POST 发布接口 → 创建图文内容
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-kuaishou-api.cjs --content /path/to/image-1/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { findImages, readContent } = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================

const CDP_PORT = 19223;
const WINDOWS_IP = '100.97.242.124';
const MAX_IMAGES = 9;

/**
 * 快手创作者中心 Cookie 域
 */
const KUAISHOU_COOKIE_DOMAINS = [
  'https://kuaishou.com',
  'https://cp.kuaishou.com',
  'https://www.kuaishou.com',
  'https://u.kuaishou.com',
];

/**
 * 快手创作者中心 API 端点
 *
 * NOTE: 若接口返回 404，请通过 Chrome DevTools Network 面板捕获真实端点：
 *       在 Windows Chrome 打开快手 CP，发布图文时记录实际请求 URL 并更新此处。
 */
const KUAISHOU_UPLOAD_TOKEN_URL = 'https://cp.kuaishou.com/rest/cp/works/upload/photo/token';
const KUAISHOU_PUBLISH_URL = 'https://cp.kuaishou.com/rest/cp/works/photo/new';

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 从 CDP Network.getCookies 响应解析 Cookie Header 字符串和会话 Token
 *
 * 快手 CP 会话关键 Cookie：
 *   - kuaishou.web.cp.api_st  — 短期会话令牌（Session Token）
 *   - kuaishou.web.cp.api_ph  — 长期持久令牌（Persistent Hash）
 *   - userId                  — 用户 ID
 *
 * @param {Array<{name:string, value:string}>} cookies - CDP cookies 数组
 * @returns {{ cookieHeader: string, sessionToken: string|null, userId: string|null }}
 */
function parseCookieHeader(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { cookieHeader: '', sessionToken: null, userId: null };
  }
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const sessionToken =
    cookies.find(
      c => c.name === 'kuaishou.web.cp.api_st' || c.name === 'kuaishou.web.cp.api_ph'
    )?.value || null;
  const userId = cookies.find(c => c.name === 'userId')?.value || null;
  return { cookieHeader, sessionToken, userId };
}

/**
 * 检测快手 CP 会话是否有效（必须包含会话令牌 Cookie）
 *
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {boolean}
 */
function isSessionValid(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  return cookies.some(
    c => c.name === 'kuaishou.web.cp.api_st' || c.name === 'kuaishou.web.cp.api_ph'
  );
}

/**
 * 检测响应是否为登录失效错误（不可重试）
 *
 * @param {number} statusCode
 * @param {string} body
 * @returns {boolean}
 */
function isLoginError(statusCode, body) {
  if (statusCode === 401 || statusCode === 403) return true;
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  const loginKeywords = [
    '未登录', '请登录', 'not login', '登录失效',
    'login required', '登录过期', 'session expired',
  ];
  return loginKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 检测响应是否为频率限制错误（可重试）
 *
 * @param {string} body
 * @returns {boolean}
 */
function isRateLimit(body) {
  if (!body || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  const rateLimitKeywords = [
    '频率限制', '操作频繁', '操作太频繁', '发布太频繁', 'too frequent', 'rate limit',
  ];
  return rateLimitKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 构建图片上传的 multipart form-data Body（不依赖第三方库）
 *
 * @param {Buffer} imageBuffer - 图片二进制数据
 * @param {string} filename - 文件名
 * @param {string} boundary - multipart boundary
 * @param {Object} extraFields - 额外表单字段（如 token、key 等）
 * @returns {Buffer} 完整的 multipart body
 */
function buildImageUploadForm(imageBuffer, filename, boundary, extraFields) {
  const fields = extraFields || {};
  const CRLF = '\r\n';
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`
    );
  }

  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`;

  const fileFooter = `${CRLF}--${boundary}--${CRLF}`;

  return Buffer.concat([
    Buffer.from(parts.join('')),
    Buffer.from(fileHeader),
    imageBuffer,
    Buffer.from(fileFooter),
  ]);
}

/**
 * 解析快手 API 响应
 *
 * 快手 CP API 通常返回：
 *   { result: 1, data: { ... } }  — 成功
 *   { result: 0, error_msg: "..." } — 失败
 *
 * @param {string} body
 * @returns {{ ok: boolean, data: any, errorMsg: string|null }}
 */
function parseKuaishouResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, data: null, errorMsg: `响应解析失败: ${body.slice(0, 200)}` };
  }

  const ok =
    parsed?.result === 1 ||
    parsed?.code === 200 ||
    parsed?.code === '200' ||
    parsed?.status === 'success';

  const errorMsg = ok
    ? null
    : parsed?.error_msg ||
      parsed?.message ||
      parsed?.msg ||
      `API 错误: ${JSON.stringify(parsed).slice(0, 200)}`;

  return { ok, data: parsed?.data ?? parsed, errorMsg };
}

// ============================================================
// HTTP 请求工具
// ============================================================

/**
 * 发起 HTTP/HTTPS 请求
 */
function httpRequest(urlStr, method, body, headers, timeoutMs) {
  const ms = timeoutMs || 30000;
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const bodyBuffer = body ? Buffer.from(body) : Buffer.alloc(0);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: Object.assign(
        {},
        headers,
        body ? { 'Content-Length': bodyBuffer.length } : {}
      ),
    };

    const req = transport.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, body: data, headers: res.headers })
      );
    });

    req.on('error', reject);
    req.setTimeout(ms, () => {
      req.destroy(new Error(`请求超时: ${urlStr}`));
    });
    if (body) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * 带重试的异步操作
 */
async function withRetry(fn, maxRetries, delayMs, isRetryable) {
  const retries = maxRetries || 3;
  const delay = delayMs || 2000;
  const canRetry = isRetryable || (() => true);
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && canRetry(err)) {
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
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
    const p = params || {};
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
      this.ws.send(JSON.stringify({ id, method, params: p }));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ============================================================
// 核心业务逻辑
// ============================================================

function getCDPPages(ip, port) {
  return withRetry(
    () =>
      new Promise((resolve, reject) => {
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
      }),
    3,
    2000
  );
}

async function extractKuaishouSession(cdp) {
  await cdp.send('Network.enable');

  const cookiesResult = await cdp.send('Network.getCookies', {
    urls: KUAISHOU_COOKIE_DOMAINS,
  });

  const cookies = cookiesResult.cookies || [];
  _log(`   提取到 ${cookies.length} 个 Cookie`);

  if (!isSessionValid(cookies)) {
    const foundNames = cookies.map(c => c.name).join(', ') || '（无）';
    throw new Error(
      `[SESSION_EXPIRED] 会话失效：未找到快手 CP 会话令牌\n` +
        `  期望: kuaishou.web.cp.api_st 或 kuaishou.web.cp.api_ph\n` +
        `  实际: ${foundNames}\n` +
        `  请在 Windows Chrome (CDP 端口 ${CDP_PORT}) 重新登录 cp.kuaishou.com`
    );
  }

  const { cookieHeader, sessionToken, userId } = parseCookieHeader(cookies);
  _log(`   Session Token: ${sessionToken ? '✅ 已获取' : '⚠️  未找到'}`);
  _log(`   User ID: ${userId || '（未知）'}`);

  return { cookieHeader, sessionToken, userId };
}

async function getUploadToken(cookieHeader) {
  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  const response = await withRetry(
    () => httpRequest(KUAISHOU_UPLOAD_TOKEN_URL, 'POST', JSON.stringify({}), headers),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('[SESSION_EXPIRED] 会话失效：获取上传 Token 时收到登录错误');
  }
  if (response.statusCode === 404) {
    throw new Error(
      `上传 Token 接口返回 404，端点可能已变更。\n` +
        `当前端点: ${KUAISHOU_UPLOAD_TOKEN_URL}\n` +
        `排查：在 Windows Chrome 打开快手 CP，发布图文时记录 Network 中上传相关请求 URL`
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(
      `获取上传 Token 失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`
    );
  }

  const { ok, data, errorMsg } = parseKuaishouResponse(response.body);
  if (!ok) throw new Error(`获取上传 Token API 错误: ${errorMsg}`);

  const uploadToken =
    data?.token || data?.upload_token || data?.uploadToken || data?.accessToken;
  const uploadEndpoint =
    data?.endpoint || data?.upload_url || data?.uploadUrl || 'https://up.qbox.me';
  const tokenKey = data?.key || data?.file_key || null;

  if (!uploadToken) {
    throw new Error(
      `上传 Token 响应中未找到 token 字段: ${JSON.stringify(data).slice(0, 300)}`
    );
  }

  return { uploadToken, uploadEndpoint, tokenKey };
}

async function uploadImage(imagePath, cookieHeader, tokenInfo) {
  const imageBuffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);
  const { uploadToken, uploadEndpoint, tokenKey } = tokenInfo;

  const boundary = `----KuaishouFormBoundary${Date.now().toString(16)}`;
  const extraFields = Object.assign(
    { token: uploadToken },
    tokenKey ? { key: tokenKey.replace('{filename}', filename) } : {}
  );

  const formBody = buildImageUploadForm(imageBuffer, filename, boundary, extraFields);
  const isKuaishouEndpoint = uploadEndpoint.includes('kuaishou.com');

  const headers = Object.assign(
    { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    isKuaishouEndpoint
      ? {
          Cookie: cookieHeader,
          Referer: 'https://cp.kuaishou.com/',
          Origin: 'https://cp.kuaishou.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      : {}
  );

  const response = await withRetry(
    () => httpRequest(uploadEndpoint, 'POST', formBody, headers, 60000),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED')
  );

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `图片上传失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`
    );
  }

  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(`图片上传响应解析失败: ${response.body.slice(0, 200)}`);
  }

  const photoId =
    result?.key ||
    result?.data?.photo_id ||
    result?.data?.photoId ||
    result?.photo_id ||
    result?.photoId;

  if (!photoId) {
    throw new Error(
      `图片上传响应中未找到 photo_id/key: ${JSON.stringify(result).slice(0, 200)}`
    );
  }

  return photoId;
}

async function publishKuaishouPost(content, photoIds, cookieHeader) {
  const payload = {
    caption: content || '',
    photo_ids: photoIds,
    type: 'photo',
    photo_type: 'image',
  };

  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/json',
    Referer: 'https://cp.kuaishou.com/',
    Origin: 'https://cp.kuaishou.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  };

  const response = await withRetry(
    () => httpRequest(KUAISHOU_PUBLISH_URL, 'POST', JSON.stringify(payload), headers),
    3,
    2000,
    err => !err.message.includes('SESSION_EXPIRED') && !err.message.includes('会话失效')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('[SESSION_EXPIRED] 会话失效：发布接口收到登录错误');
  }
  if (isRateLimit(response.body)) {
    throw new Error('快手限频：发布太频繁，请稍后重试');
  }
  if (response.statusCode === 404) {
    throw new Error(
      `发布接口返回 404，端点可能已变更。\n` +
        `当前端点: ${KUAISHOU_PUBLISH_URL}\n` +
        `排查：在 Windows Chrome 打开快手 CP，发布图文时记录 Network 中发布请求 URL`
    );
  }
  if (response.statusCode !== 200) {
    throw new Error(`发布失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 300)}`);
  }

  const { ok, data, errorMsg } = parseKuaishouResponse(response.body);
  if (!ok) throw new Error(`发布 API 错误: ${errorMsg}`);

  const postId =
    data?.photo_id || data?.photoId || data?.work_id || data?.workId || data?.id;

  return {
    postUrl: postId
      ? `https://cp.kuaishou.com/article/manage/photo-video?photoId=${postId}`
      : null,
    postId: postId || null,
  };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const contentDirArg = args[args.indexOf('--content') + 1];

  if (!contentDirArg || !fs.existsSync(contentDirArg)) {
    console.error('❌ 错误：必须提供有效的内容目录路径');
    console.error('使用方式：node publish-kuaishou-api.cjs --content /path/to/image-xxx/');
    process.exit(1);
  }

  const contentDir = path.resolve(contentDirArg);
  const contentText = readContent(contentDir);
  const allImages = findImages(contentDir);

  if (allImages.length === 0) {
    console.error('❌ 错误：内容目录中没有图片文件');
    process.exit(1);
  }

  const localImages =
    allImages.length > MAX_IMAGES ? allImages.slice(0, MAX_IMAGES) : allImages;
  if (allImages.length > MAX_IMAGES) {
    console.warn(`⚠️  图片数量 ${allImages.length} 超过快手限制 ${MAX_IMAGES}，已截断`);
  }

  _log('\n========================================');
  _log('快手图文发布（新 API 方案）');
  _log('========================================\n');
  _log(`📁 内容目录: ${contentDir}`);
  _log(`📝 文案长度: ${contentText.length} 字符`);
  _log(`🖼️  图片数量: ${localImages.length}`);
  _log('');

  let cdp;

  try {
    _log('1️⃣  连接 CDP 提取会话 Cookie...\n');
    const pagesData = await getCDPPages(WINDOWS_IP, CDP_PORT);
    const kuaishouPage = pagesData.find(
      p => p.type === 'page' && p.url.includes('kuaishou.com')
    );
    const targetPage = kuaishouPage || pagesData.find(p => p.type === 'page');
    if (!targetPage) throw new Error('未找到任何浏览器页面');
    if (!kuaishouPage) _log(`   ⚠️  未找到快手页面，使用: ${targetPage.url}`);

    cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    _log('   ✅ CDP 已连接\n');

    const { cookieHeader } = await extractKuaishouSession(cdp);
    _log('   ✅ 会话 Cookie 已提取\n');

    _log('2️⃣  获取图片上传 Token...\n');
    const tokenInfo = await getUploadToken(cookieHeader);
    _log(`   ✅ 上传 Token 已获取，端点: ${tokenInfo.uploadEndpoint}\n`);

    _log(`3️⃣  上传图片（${localImages.length} 张）...\n`);
    const photoIds = [];
    for (let i = 0; i < localImages.length; i++) {
      const imgPath = localImages[i];
      const filename = path.basename(imgPath);
      process.stdout.write(`   [${i + 1}/${localImages.length}] 上传 ${filename}... `);
      const photoId = await uploadImage(imgPath, cookieHeader, tokenInfo);
      photoIds.push(photoId);
      _log(`✅ id: ${photoId}`);
    }
    _log(`\n   ✅ 全部图片上传完成，photo_ids: [${photoIds.join(', ')}]\n`);

    _log('4️⃣  发布图文...\n');
    const { postUrl, postId } = await publishKuaishouPost(contentText, photoIds, cookieHeader);

    _log('\n✅ 快手图文发布成功！');
    if (postId) _log(`   作品 ID: ${postId}`);
    if (postUrl) _log(`   管理链接: ${postUrl}`);
  } catch (err) {
    const isSessError = err.message.includes('[SESSION_EXPIRED]');
    console.error(`\n${isSessError ? '[SESSION_EXPIRED]' : '❌'} 发布失败: ${err.message}`);
    process.exit(isSessError ? 2 : 1);
  } finally {
    if (cdp) cdp.close();
  }
}

if (require.main === module) {
  main();
}

// 导出纯函数供单元测试使用
module.exports = {
  parseCookieHeader,
  isSessionValid,
  isLoginError,
  isRateLimit,
  buildImageUploadForm,
  parseKuaishouResponse,
};
