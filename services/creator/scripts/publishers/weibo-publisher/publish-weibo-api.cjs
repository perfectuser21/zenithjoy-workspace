#!/usr/bin/env node
/**
 * 微博新接口图文发布脚本
 *
 * 技术方案：CDP 提取 Cookie → HTTP API 直接调用
 *
 * 对比旧方案 (publish-weibo-image.cjs)：
 *   旧方案：CDP 控制浏览器 UI（点击、填表）→ 触发验证码、受页面改版影响
 *   新方案：CDP 仅用于提取 Cookie → HTTP 直接调用内部 API → 稳定、快速
 *
 * 发布流程：
 *   1. CDP 连接 Windows Chrome → 提取微博会话 Cookie
 *   2. 逐张上传图片 → picupload.weibo.com → 收集 pic_id
 *   3. POST 发布接口 → weibo.com/ajax/statuses/update → 带 pic_ids + 文案
 *
 * 用法：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules \
 *     node publish-weibo-api.cjs --content /path/to/image-1/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选，支持话题 #xxx#）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等，最多 9 张）
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { CDPClient } = require('./cdp-client.cjs');
const { findImages, readContent, withRetry } = require('./utils.cjs');

// ============================================================
// 配置
// ============================================================

const CDP_PORT = 19227;
const WINDOWS_IP = '100.97.242.124';
const MAX_IMAGES = 9;

const WEIBO_COOKIE_DOMAINS = [
  'https://weibo.com',
  'https://www.weibo.com',
  'https://picupload.weibo.com',
];

const WEIBO_PIC_UPLOAD_URL = 'https://picupload.weibo.com/interface/pic_upload.php';
const WEIBO_STATUS_UPDATE_URL = 'https://www.weibo.com/ajax/statuses/update';

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 从 CDP Network.getCookies 响应解析 Cookie Header 字符串和 XSRF Token
 *
 * @param {Array<{name:string, value:string}>} cookies - CDP cookies 数组
 * @returns {{ cookieHeader: string, xsrfToken: string|null }}
 */
function parseCookieHeader(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { cookieHeader: '', xsrfToken: null };
  }
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const xsrfToken =
    cookies.find(c => c.name === 'XSRF-TOKEN' || c.name === 'xsrf-token' || c.name === '_xsrf')
      ?.value || null;
  return { cookieHeader, xsrfToken };
}

/**
 * 从 Cookie Header 字符串提取特定 cookie 值
 *
 * @param {string} cookieHeader
 * @param {string} name
 * @returns {string|null}
 */
function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 检测响应体是否为限频错误（可重试）
 *
 * @param {string} body - 响应体文本
 * @returns {boolean}
 */
function isRateLimit(body) {
  if (!body || typeof body !== 'string') return false;
  const rateLimitKeywords = [
    '发帖太频繁',
    '操作太频繁',
    '操作过于频繁',
    '频率限制',
    '限制发言',
    'too frequent',
    'rate limit',
  ];
  const lower = body.toLowerCase();
  return rateLimitKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 检测响应是否为登录失效错误（不可重试）
 *
 * @param {number} statusCode - HTTP 状态码
 * @param {string} body - 响应体文本
 * @returns {boolean}
 */
function isLoginError(statusCode, body) {
  if (statusCode === 401 || statusCode === 403) return true;
  if (!body || typeof body !== 'string') return false;
  const loginKeywords = ['未登录', '请登录', 'not login', '登录失效', 'login required'];
  const lower = body.toLowerCase();
  return loginKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 构建图片上传 multipart form data（不依赖 form-data 库）
 *
 * @param {Buffer} imageBuffer - 图片二进制数据
 * @param {string} filename - 文件名
 * @param {string} boundary - multipart boundary 字符串
 * @returns {Buffer} 完整的 multipart body
 */
function buildPicUploadForm(imageBuffer, filename, boundary) {
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

  const fields = [
    ['encoded', '1'],
    ['mark', '0'],
    ['ori', '1'],
    ['s', '6'],
    ['pri', 'null'],
    ['album_id', 'null'],
    ['display_source', '1'],
    ['pid', '1'],
    ['type', 'json'],
  ];

  const parts = [];
  for (const [name, value] of fields) {
    parts.push(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`
    );
  }

  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="b64_data"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`;

  const fileFooter = `${CRLF}--${boundary}--${CRLF}`;

  return Buffer.concat([
    Buffer.from(parts.join('')),
    Buffer.from(fileHeader),
    imageBuffer,
    Buffer.from(fileFooter),
  ]);
}

// ============================================================
// HTTP 请求工具
// ============================================================

/**
 * 发起 HTTPS POST 请求
 *
 * @param {string} urlStr
 * @param {Buffer|string} body
 * @param {Object} headers
 * @returns {Promise<{statusCode: number, body: string, headers: Object}>}
 */
function httpsPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, body: data, headers: res.headers })
      );
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error(`请求超时: ${urlStr}`));
    });
    req.write(body);
    req.end();
  });
}

// ============================================================
// 核心业务逻辑
// ============================================================

/**
 * 通过 CDP 提取微博会话 Cookie
 *
 * @param {CDPClient} cdp
 * @returns {Promise<{cookieHeader: string, xsrfToken: string|null}>}
 */
async function extractWeiboSession(cdp) {
  await cdp.send('Network.enable');

  const cookiesResult = await cdp.send('Network.getCookies', {
    urls: WEIBO_COOKIE_DOMAINS,
  });

  const cookies = cookiesResult.cookies || [];
  console.log(`   提取到 ${cookies.length} 个 Cookie`);

  const subCookie = cookies.find(c => c.name === 'SUB');
  if (!subCookie) {
    throw new Error('会话失效：未找到 SUB Cookie，请在 Windows Chrome (19227) 重新登录微博');
  }

  const { cookieHeader, xsrfToken } = parseCookieHeader(cookies);
  console.log(`   XSRF Token: ${xsrfToken ? '✅ 已获取' : '⚠️  未找到（将尝试无 token 发布）'}`);

  return { cookieHeader, xsrfToken };
}

/**
 * 上传单张图片到微博图片服务
 *
 * @param {string} imagePath - 本地图片绝对路径
 * @param {string} cookieHeader - 会话 Cookie
 * @returns {Promise<string>} pic_id
 */
async function uploadImage(imagePath, cookieHeader) {
  const imageBuffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);
  const boundary = `----WeiboFormBoundary${Date.now().toString(16)}`;
  const formBody = buildPicUploadForm(imageBuffer, filename, boundary);

  const headers = {
    Cookie: cookieHeader,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    Referer: 'https://www.weibo.com/',
    Origin: 'https://www.weibo.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  const response = await withRetry(
    () => httpsPost(WEIBO_PIC_UPLOAD_URL, formBody, headers),
    3,
    2000,
    err => !err.message.includes('会话失效') && !err.message.includes('未登录')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('会话失效：图片上传收到登录错误，请重新登录微博');
  }
  if (response.statusCode !== 200) {
    throw new Error(`图片上传失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 200)}`);
  }

  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(`图片上传响应解析失败: ${response.body.slice(0, 200)}`);
  }

  const picId = result?.data?.pic_id || result?.pic_id || result?.picId;
  if (!picId) {
    throw new Error(`图片上传响应中未找到 pic_id: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return picId;
}

/**
 * 发布微博（文字 + 图片 ID 列表）
 *
 * @param {string} content - 文案内容
 * @param {string[]} picIds - 已上传图片的 ID 数组
 * @param {string} cookieHeader - 会话 Cookie
 * @param {string|null} xsrfToken - XSRF Token
 * @returns {Promise<{postUrl: string|null, weiboId: string|null}>}
 */
async function postWeibo(content, picIds, cookieHeader, xsrfToken) {
  const params = new URLSearchParams();
  params.append('content', content);
  params.append('visible', '0');
  params.append('longitude', '0.0');
  params.append('latitude', '0.0');
  params.append('tid', '');
  if (picIds.length > 0) {
    params.append('pic_ids', picIds.join(','));
  }

  const headers = {
    Cookie: cookieHeader,
    'Content-Type': 'application/x-www-form-urlencoded',
    Referer: 'https://www.weibo.com/',
    Origin: 'https://www.weibo.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (xsrfToken) {
    headers['X-Xsrf-Token'] = xsrfToken;
  }

  const response = await withRetry(
    () => httpsPost(WEIBO_STATUS_UPDATE_URL, params.toString(), headers),
    3,
    2000,
    err => !err.message.includes('会话失效') && !err.message.includes('未登录')
  );

  if (isLoginError(response.statusCode, response.body)) {
    throw new Error('会话失效：发布接口收到登录错误，请重新登录微博');
  }
  if (isRateLimit(response.body)) {
    throw new Error('微博限频：发帖太频繁，请等待后重试');
  }
  if (response.statusCode !== 200) {
    throw new Error(`发布失败 (HTTP ${response.statusCode}): ${response.body.slice(0, 200)}`);
  }

  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(`发布响应解析失败: ${response.body.slice(0, 200)}`);
  }

  if (result?.ok !== 1 && result?.code !== '100000') {
    const errMsg = result?.error || result?.message || JSON.stringify(result).slice(0, 200);
    throw new Error(`发布接口返回错误: ${errMsg}`);
  }

  const postId = result?.data?.id || result?.data?.mid || result?.id;
  return { postUrl: postId ? `https://weibo.com/${postId}` : null, weiboId: postId || null };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const contentDirArg = args[args.indexOf('--content') + 1];

  if (!contentDirArg || !fs.existsSync(contentDirArg)) {
    console.error('❌ 错误：必须提供有效的内容目录路径');
    console.error('使用方式：node publish-weibo-api.cjs --content /path/to/image-xxx/');
    process.exit(1);
  }

  const contentDir = path.resolve(contentDirArg);
  const contentText = readContent(contentDir);
  const allImages = findImages(contentDir);

  if (allImages.length === 0) {
    console.error('❌ 错误：内容目录中没有图片文件');
    process.exit(1);
  }

  const localImages = allImages.length > MAX_IMAGES ? allImages.slice(0, MAX_IMAGES) : allImages;
  if (allImages.length > MAX_IMAGES) {
    console.warn(`⚠️  图片数量 ${allImages.length} 超过微博限制 ${MAX_IMAGES}，已截断`);
  }

  console.log('\n========================================');
  console.log('微博图文发布（新 API 方案）');
  console.log('========================================\n');
  console.log(`📁 内容目录: ${contentDir}`);
  console.log(`📝 文案长度: ${contentText.length} 字符`);
  console.log(`🖼️  图片数量: ${localImages.length}`);
  console.log('');

  let cdp;

  try {
    // ===== 步骤1: CDP 连接提取 Cookie =====
    console.log('1️⃣  连接 CDP 提取会话 Cookie...\n');

    const pagesData = await withRetry(
      () =>
        new Promise((resolve, reject) => {
          http
            .get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
              let data = '';
              res.on('data', chunk => (data += chunk));
              res.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(new Error(`CDP 响应解析失败: ${e.message}`));
                }
              });
            })
            .on('error', err => {
              reject(
                new Error(
                  `CDP 连接失败 (${WINDOWS_IP}:${CDP_PORT}): ${err.message}\n` +
                    `排查：curl http://${WINDOWS_IP}:${CDP_PORT}/json`
                )
              );
            });
        }),
      3,
      2000
    );

    const weiboPage = pagesData.find(p => p.type === 'page' && p.url.includes('weibo.com'));
    const targetPage = weiboPage || pagesData.find(p => p.type === 'page');
    if (!targetPage) throw new Error('未找到任何浏览器页面');

    if (!weiboPage) console.log(`   ⚠️  未找到微博页面，使用: ${targetPage.url}`);

    cdp = new CDPClient(targetPage.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('   ✅ CDP 已连接\n');

    const { cookieHeader, xsrfToken } = await extractWeiboSession(cdp);
    console.log('   ✅ 会话 Cookie 已提取\n');

    // ===== 步骤2: 上传图片 =====
    console.log(`2️⃣  上传图片（${localImages.length} 张）...\n`);
    const picIds = [];

    for (let i = 0; i < localImages.length; i++) {
      const imgPath = localImages[i];
      const filename = path.basename(imgPath);
      process.stdout.write(`   [${i + 1}/${localImages.length}] 上传 ${filename}... `);
      const picId = await uploadImage(imgPath, cookieHeader);
      picIds.push(picId);
      console.log(`✅ pic_id: ${picId}`);
    }

    console.log(`\n   ✅ 全部图片上传完成，pic_ids: [${picIds.join(', ')}]\n`);

    // ===== 步骤3: 发布微博 =====
    console.log('3️⃣  发布微博...\n');

    const { postUrl, weiboId } = await postWeibo(
      contentText || '',
      picIds,
      cookieHeader,
      xsrfToken
    );

    console.log('\n✅ 微博发布成功！');
    if (weiboId) console.log(`   微博 ID: ${weiboId}`);
    if (postUrl) console.log(`   链接: ${postUrl}`);
  } catch (err) {
    console.error(`\n❌ 发布失败: ${err.message}`);
    process.exit(1);
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
  getCookieValue,
  isRateLimit,
  isLoginError,
  buildPicUploadForm,
};
