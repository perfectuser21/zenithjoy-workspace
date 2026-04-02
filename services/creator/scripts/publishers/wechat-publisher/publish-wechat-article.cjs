const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 微信公众号图文发布脚本
 *
 * 技术方案：微信公众平台官方 API
 *
 * 发布流程：
 *   1. 读取凭据 (~/.credentials/wechat.env)
 *   2. 获取 / 刷新 Access Token (缓存到 /tmp/wechat_token.json)
 *   3. 上传封面图片 → material/add_material → 获取 thumb_media_id（可选）
 *   4. 上传正文内嵌图片 → media/uploadimg → 替换 HTML src 为微信 CDN URL
 *   5. 创建草稿 → draft/add → 获取 media_id
 *   6. 提交发布 → freepublish/submit → publish_id
 *
 * 用法：
 *   node publish-wechat-article.cjs \
 *     --title "文章标题" \
 *     --content "HTML 正文内容" \
 *     [--author "作者名"] \
 *     [--digest "文章摘要"] \
 *     [--cover /path/to/cover.jpg]
 *
 * 内容目录模式（与其他发布器兼容）：
 *   node publish-wechat-article.cjs --content-dir /path/to/content/
 *   目录结构：
 *     title.txt      - 文章标题（必需）
 *     content.html   - HTML 正文（必需）
 *     content.txt    - 纯文本正文（如无 content.html，转为简单 HTML）
 *     digest.txt     - 摘要（可选）
 *     author.txt     - 作者（可选）
 *     cover.jpg      - 封面图（可选）
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// ============================================================
// 常量配置
// ============================================================

const WECHAT_API_BASE = 'https://api.weixin.qq.com';
const TOKEN_CACHE_FILE = '/tmp/wechat_token.json';
const CREDENTIALS_FILE = path.join(os.homedir(), '.credentials', 'wechat.env');
const TOKEN_MARGIN_SECONDS = 300; // 提前 5 分钟刷新

// ============================================================
// 纯工具函数（可单元测试）
// ============================================================

/**
 * 解析 .env 文件为 key-value 对象
 *
 * @param {string} content - .env 文件内容
 * @returns {Record<string, string>}
 */
function parseEnvFile(content) {
  if (!content || typeof content !== 'string') return {};
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

/**
 * 检查 Token 缓存是否有效（未过期）
 *
 * @param {{ access_token: string, expires_at: number }} cache - 缓存对象
 * @param {number} [nowMs] - 当前时间戳（毫秒），默认 Date.now()
 * @returns {boolean}
 */
function isTokenCacheValid(cache, nowMs) {
  if (!cache || typeof cache.access_token !== 'string' || !cache.access_token) return false;
  if (typeof cache.expires_at !== 'number') return false;
  const now = nowMs !== undefined ? nowMs : Date.now();
  return cache.expires_at - now > TOKEN_MARGIN_SECONDS * 1000;
}

/**
 * 构建 Token 缓存对象
 *
 * @param {string} accessToken
 * @param {number} expiresIn - 有效期（秒）
 * @param {number} [nowMs] - 当前时间戳（毫秒）
 * @returns {{ access_token: string, expires_at: number, obtained_at: number }}
 */
function buildTokenCache(accessToken, expiresIn, nowMs) {
  const now = nowMs !== undefined ? nowMs : Date.now();
  return {
    access_token: accessToken,
    expires_at: now + expiresIn * 1000,
    obtained_at: now,
  };
}

/**
 * 将纯文本转换为简单 HTML 段落
 *
 * @param {string} text
 * @returns {string}
 */
function textToHtml(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .split('\n')
    .map(line => {
      const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return escaped ? `<p>${escaped}</p>` : '<p><br/></p>';
    })
    .join('\n');
}

/**
 * 从内容目录读取文章数据
 *
 * @param {string} contentDir
 * @returns {{ title: string, content: string, digest: string, author: string, coverPath: string|null }}
 */
function readContentDir(contentDir) {
  const read = filename => {
    const p = path.join(contentDir, filename);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
  };

  const title = read('title.txt');
  if (!title) throw new Error(`内容目录缺少 title.txt: ${contentDir}`);

  let content = read('content.html');
  if (!content) {
    const text = read('content.txt');
    if (!text) throw new Error(`内容目录缺少 content.html 或 content.txt: ${contentDir}`);
    content = textToHtml(text);
  }

  const digest = read('digest.txt') || title.slice(0, 54);
  const author = read('author.txt') || '';

  const coverExts = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp'];
  const coverPath =
    coverExts.map(f => path.join(contentDir, f)).find(p => fs.existsSync(p)) || null;

  return { title, content, digest, author, coverPath };
}

// ============================================================
// HTTP 工具
// ============================================================

/**
 * 发起 HTTPS GET 请求
 *
 * @param {string} urlStr
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`GET 请求超时: ${urlStr}`)));
  });
}

/**
 * 发起 HTTPS POST 请求
 *
 * @param {string} urlStr
 * @param {Buffer|string} body
 * @param {Object} headers
 * @returns {Promise<{ statusCode: number, body: string }>}
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
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error(`POST 请求超时: ${urlStr}`)));
    req.write(body);
    req.end();
  });
}

/**
 * 解析 API 响应（JSON），并检查微信错误码
 *
 * @param {{ statusCode: number, body: string }} response
 * @param {string} context - 用于错误信息的上下文描述
 * @returns {Object} 解析后的 JSON
 * @throws {Error} HTTP 错误或微信 errcode 非零时抛出
 */
function parseWechatResponse(response, context) {
  if (response.statusCode !== 200) {
    throw new Error(`${context} HTTP ${response.statusCode}: ${response.body.slice(0, 200)}`);
  }
  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(`${context} 响应解析失败: ${response.body.slice(0, 200)}`);
  }
  if (result.errcode && result.errcode !== 0) {
    throw new Error(`${context} 微信错误 errcode=${result.errcode} errmsg=${result.errmsg}`);
  }
  return result;
}

// ============================================================
// Token 管理
// ============================================================

/**
 * 从微信 API 获取新 Access Token
 *
 * @param {string} appId
 * @param {string} appSecret
 * @returns {Promise<{ accessToken: string, expiresIn: number }>}
 */
async function fetchNewToken(appId, appSecret) {
  const url =
    `${WECHAT_API_BASE}/cgi-bin/token` +
    `?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;

  const response = await httpsGet(url);
  const result = parseWechatResponse(response, '获取 Access Token');

  if (!result.access_token) {
    throw new Error(`获取 Access Token 失败：响应中无 access_token: ${JSON.stringify(result)}`);
  }

  return { accessToken: result.access_token, expiresIn: result.expires_in || 7200 };
}

/**
 * 获取有效 Access Token（优先读缓存，过期则重新获取）
 *
 * @param {string} appId
 * @param {string} appSecret
 * @returns {Promise<string>} access_token
 */
async function getAccessToken(appId, appSecret) {
  if (fs.existsSync(TOKEN_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
      if (isTokenCacheValid(cached)) {
        _log('   ✅ 使用缓存 Token（有效）');
        return cached.access_token;
      }
      _log('   ⚠️  缓存 Token 已过期，重新获取...');
    } catch {
      _log('   ⚠️  Token 缓存读取失败，重新获取...');
    }
  }

  const { accessToken, expiresIn } = await fetchNewToken(appId, appSecret);
  const cache = buildTokenCache(accessToken, expiresIn);

  try {
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
    _log(`   ✅ 新 Token 已缓存（有效期 ${expiresIn}s）`);
  } catch (err) {
    console.warn(`   ⚠️  Token 缓存写入失败: ${err.message}`);
  }

  return accessToken;
}

// ============================================================
// 媒体上传
// ============================================================

/**
 * 构建 multipart/form-data 请求体
 *
 * @param {Buffer} imageBuffer
 * @param {string} filename
 * @param {string} mimeType
 * @param {string} boundary
 * @returns {Buffer}
 */
function buildMultipartBody(imageBuffer, filename, mimeType, boundary) {
  const CRLF = '\r\n';
  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="media"; filename="${filename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  return Buffer.concat([Buffer.from(header), imageBuffer, Buffer.from(footer)]);
}

/**
 * 获取图片 MIME 类型
 *
 * @param {string} filename
 * @returns {string}
 */
function getImageMime(filename) {
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeMap[path.extname(filename).toLowerCase()] || 'image/jpeg';
}

/**
 * 上传图片到公众号内容素材（media/uploadimg）
 * 用于正文内嵌图片，返回微信 CDN URL
 *
 * @param {string} imagePath - 本地图片路径
 * @param {string} accessToken
 * @returns {Promise<string>} 图片 URL
 */
async function uploadContentImage(imagePath, accessToken) {
  const imageBuffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);
  const boundary = `----WechatFormBoundary${Date.now().toString(16)}`;
  const body = buildMultipartBody(imageBuffer, filename, getImageMime(filename), boundary);

  const url = `${WECHAT_API_BASE}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
  const response = await httpsPost(url, body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });

  const result = parseWechatResponse(response, `上传内容图片 ${filename}`);
  if (!result.url) {
    throw new Error(`上传内容图片失败：响应中无 url: ${JSON.stringify(result)}`);
  }
  return result.url;
}

/**
 * 上传封面图片为永久素材（material/add_material）
 * 返回 thumb_media_id，用于草稿 API 的 thumb_media_id 字段
 *
 * @param {string} imagePath - 本地图片路径
 * @param {string} accessToken
 * @returns {Promise<string>} media_id
 */
async function uploadCoverImage(imagePath, accessToken) {
  const imageBuffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);
  const boundary = `----WechatFormBoundary${Date.now().toString(16)}`;
  const body = buildMultipartBody(imageBuffer, filename, getImageMime(filename), boundary);

  const url =
    `${WECHAT_API_BASE}/cgi-bin/material/add_material` +
    `?access_token=${encodeURIComponent(accessToken)}&type=image`;
  const response = await httpsPost(url, body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });

  const result = parseWechatResponse(response, '上传封面图片');
  if (!result.media_id) {
    throw new Error(`上传封面图片失败：响应中无 media_id: ${JSON.stringify(result)}`);
  }
  return result.media_id;
}

/**
 * 从素材库获取第一张图片的 media_id，作为默认封面
 *
 * @param {string} accessToken
 * @returns {Promise<string|null>} media_id 或 null
 */
async function getDefaultThumbMediaId(accessToken) {
  const url =
    `${WECHAT_API_BASE}/cgi-bin/material/batchget_material` +
    `?access_token=${encodeURIComponent(accessToken)}`;
  const payload = JSON.stringify({ type: 'image', offset: 0, count: 1 });
  try {
    const response = await httpsPost(url, payload, { 'Content-Type': 'application/json' });
    const result = JSON.parse(response.body);
    if (result.item && result.item.length > 0) {
      return result.item[0].media_id;
    }
  } catch {
    // 忽略错误，调用方处理 null
  }
  return null;
}

/**
 * 解析 HTML，将本地图片路径上传到微信 CDN，替换 src 为微信 URL
 *
 * 规则：
 * - src 以 http:// 或 https:// 开头 → 跳过（外链不处理）
 * - 相对路径 → 相对 contentDir 解析为绝对路径
 * - 绝对路径 → 直接使用
 * - 文件不存在 → 打印警告，保留原 src
 * - 上传失败 → 打印警告，保留原 src
 *
 * @param {string} html - 原始 HTML
 * @param {string} accessToken
 * @param {string} [contentDir] - 相对路径的基准目录
 * @returns {Promise<string>} 替换后的 HTML
 */
async function uploadInlineImages(html, accessToken, contentDir) {
  if (!html || typeof html !== 'string') return html;

  const imgRegex = /<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi;
  const replacements = [];
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const [fullTag, before, src, after] = match;
    if (src.startsWith('http://') || src.startsWith('https://')) continue;

    const absPath = path.isAbsolute(src)
      ? src
      : contentDir
        ? path.resolve(contentDir, src)
        : path.resolve(src);

    replacements.push({ fullTag, before, src, after, absPath });
  }

  if (replacements.length === 0) return html;

  _log(`   📸 检测到 ${replacements.length} 张内嵌图片，开始上传...`);

  let result = html;
  for (const { fullTag, before, src, after, absPath } of replacements) {
    if (!fs.existsSync(absPath)) {
      console.warn(`   ⚠️  图片不存在，跳过: ${absPath}`);
      continue;
    }
    try {
      const wechatUrl = await uploadContentImage(absPath, accessToken);
      const newTag = `<img${before}src="${wechatUrl}"${after}>`;
      result = result.replace(fullTag, newTag);
      _log(`   ✅ ${path.basename(src)} → 微信 CDN`);
    } catch (err) {
      console.warn(`   ⚠️  图片上传失败，保留原路径 (${path.basename(src)}): ${err.message}`);
    }
  }

  return result;
}

// ============================================================
// 草稿 & 发布
// ============================================================

/**
 * 创建草稿文章
 *
 * @param {{ title: string, content: string, digest: string, author: string, thumbMediaId?: string }} article
 * @param {string} accessToken
 * @returns {Promise<string>} media_id（草稿 ID）
 */
async function createDraft(article, accessToken) {
  const articleData = {
    title: article.title,
    author: article.author || '',
    digest: article.digest || '',
    content: article.content,
    content_source_url: '',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };

  if (article.thumbMediaId) {
    articleData.thumb_media_id = article.thumbMediaId;
  }

  const payload = JSON.stringify({ articles: [articleData] });
  const url = `${WECHAT_API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
  const response = await httpsPost(url, payload, {
    'Content-Type': 'application/json; charset=utf-8',
  });

  const result = parseWechatResponse(response, '创建草稿');
  if (!result.media_id) {
    throw new Error(`创建草稿失败：响应中无 media_id: ${JSON.stringify(result)}`);
  }

  return result.media_id;
}

/**
 * 提交草稿发布
 *
 * @param {string} mediaId - 草稿 media_id
 * @param {string} accessToken
 * @returns {Promise<string>} publish_id 或 'ok'
 */
async function publishDraft(mediaId, accessToken) {
  const payload = JSON.stringify({ media_id: mediaId });
  const url = `${WECHAT_API_BASE}/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`;
  const response = await httpsPost(url, payload, {
    'Content-Type': 'application/json; charset=utf-8',
  });

  const result = parseWechatResponse(response, '提交发布');
  return result.publish_id || result.publishId || 'ok';
}

// ============================================================
// 凭据加载
// ============================================================

/**
 * 加载公众号凭据
 *
 * @returns {{ appId: string, appSecret: string }}
 */
function loadCredentials() {
  let appId = process.env.WECHAT_APPID;
  let appSecret = process.env.WECHAT_APPSECRET;

  if (!appId || !appSecret) {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const env = parseEnvFile(content);
      appId = appId || env.WECHAT_APPID;
      appSecret = appSecret || env.WECHAT_APPSECRET;
    }
  }

  if (!appId || !appSecret) {
    console.error('❌ 缺少公众号凭据');
    console.error('');
    console.error('请创建 ~/.credentials/wechat.env，内容如下：');
    console.error('  WECHAT_APPID=wx1234567890abcdef');
    console.error('  WECHAT_APPSECRET=your_app_secret_here');
    console.error('');
    console.error('或设置环境变量 WECHAT_APPID / WECHAT_APPSECRET');
    process.exit(2);
  }

  return { appId, appSecret };
}

// ============================================================
// 参数解析
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const contentDir = get('--content-dir');
  if (contentDir) {
    if (!fs.existsSync(contentDir)) {
      console.error(`❌ 内容目录不存在: ${contentDir}`);
      process.exit(1);
    }
    return { ...readContentDir(contentDir), contentDir };
  }

  const title = get('--title');
  const contentRaw = get('--content');

  if (!title) {
    console.error('❌ 错误：必须提供 --title 或 --content-dir');
    console.error('用法：');
    console.error('  node publish-wechat-article.cjs --title "标题" --content "正文内容"');
    console.error('  node publish-wechat-article.cjs --content-dir /path/to/content/');
    process.exit(1);
  }
  if (!contentRaw) {
    console.error('❌ 错误：必须提供 --content 或 --content-dir');
    process.exit(1);
  }

  const content = contentRaw.trim().startsWith('<') ? contentRaw : textToHtml(contentRaw);
  const digest = get('--digest') || title.slice(0, 54);
  const author = get('--author') || '';
  const coverPath = get('--cover') || null;

  return { title, content, digest, author, coverPath, contentDir: null };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  _log('\n========================================');
  _log('微信公众号图文发布（官方 API）');
  _log('========================================\n');

  const { appId, appSecret } = loadCredentials();
  _log(`📋 AppID: ${appId.slice(0, 8)}...`);

  let articleArgs;
  try {
    articleArgs = parseArgs();
  } catch (err) {
    console.error(`❌ 参数错误: ${err.message}`);
    process.exit(1);
  }

  const { title, content: rawContent, digest, author, coverPath, contentDir: argContentDir } = articleArgs;
  _log(`📝 标题: ${title}`);
  _log(`📄 正文: ${rawContent.length} 字符`);
  if (coverPath) _log(`🖼️  封面: ${coverPath}`);
  _log('');

  try {
    _log('1️⃣  获取 Access Token...\n');
    const accessToken = await getAccessToken(appId, appSecret);
    _log('');

    let thumbMediaId;
    if (coverPath) {
      _log('2️⃣  上传封面图片（永久素材）...\n');
      try {
        thumbMediaId = await uploadCoverImage(coverPath, accessToken);
        _log(`   ✅ 封面已上传，thumb_media_id: ${thumbMediaId.slice(0, 20)}...\n`);
      } catch (err) {
        console.warn(`   ⚠️  封面上传失败，继续发布（无封面）: ${err.message}\n`);
      }
    } else {
      _log('2️⃣  未提供封面，从素材库获取默认封面...\n');
      try {
        thumbMediaId = await getDefaultThumbMediaId(accessToken);
        if (thumbMediaId) {
          _log(`   ✅ 使用默认封面 media_id: ${thumbMediaId.slice(0, 20)}...\n`);
        } else {
          console.warn('   ⚠️  素材库无图片，草稿将不含封面\n');
        }
      } catch (err) {
        console.warn(`   ⚠️  获取默认封面失败: ${err.message}\n`);
      }
    }

    _log('3️⃣  处理正文内嵌图片...\n');
    const content = await uploadInlineImages(rawContent, accessToken, argContentDir);
    _log('');

    _log('4️⃣  创建草稿...\n');
    const mediaId = await createDraft({ title, content, digest, author, thumbMediaId }, accessToken);
    _log(`   ✅ 草稿已创建，media_id: ${mediaId}\n`);

    _log('5️⃣  提交发布...\n');
    const publishId = await publishDraft(mediaId, accessToken);
    _log(`   ✅ 已提交发布，publish_id: ${publishId}\n`);

    _log('✅ 公众号文章发布成功！');
    _log('   注意：文章进入发布队列，稍后在公众号后台可查看状态');
  } catch (err) {
    console.error(`\n❌ 发布失败: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// 导出纯函数供单元测试
module.exports = {
  parseEnvFile,
  isTokenCacheValid,
  buildTokenCache,
  textToHtml,
  readContentDir,
  uploadInlineImages,
};
