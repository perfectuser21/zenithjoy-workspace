#!/usr/bin/env node
/**
 * 微信公众号「仅草稿」发布脚本（draft-only wrapper）
 *
 * 与 publish-wechat-article.cjs（群发版）严格隔离：
 *   - 本脚本**只**调用 draft/add 创建草稿
 *   - 不调 freepublish/submit、不调 message/mass/sendall
 *   - 用于 ZenithJoy Agent v0.1 链路自检（中台 → Agent → 公众号草稿箱）
 *
 * 用法：
 *   node publish-wechat-article-draft.cjs --draft-only \
 *     --title "标题" \
 *     --body "<p>HTML 正文</p>" \
 *     [--digest "摘要"] [--author "作者"]
 *
 * 输出：
 *   stdout 最后一行为 JSON（machine readable）：
 *     {"ok":true,"draft":true,"mediaId":"<draft media_id>"}
 *   失败时 exit code 非 0，错误信息打到 stderr。
 *
 * 凭据：复用 ~/.credentials/wechat.env（与 publish-wechat-article.cjs 一致）。
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// 复用主发布脚本的纯函数（避免重复实现）
const {
  parseEnvFile,
  isTokenCacheValid,
  buildTokenCache,
  textToHtml,
} = require('./publish-wechat-article.cjs');

const WECHAT_API_BASE = 'https://api.weixin.qq.com';
const TOKEN_CACHE_FILE = '/tmp/wechat_token.json';
const CREDENTIALS_FILE = path.join(os.homedir(), '.credentials', 'wechat.env');

// ---------- HTTP ----------

function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`GET 超时: ${urlStr}`)));
  });
}

function httpsPost(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error(`POST 超时: ${urlStr}`)));
    req.write(body);
    req.end();
  });
}

function parseWechatResponse(response, context) {
  if (response.statusCode !== 200) {
    throw new Error(`${context} HTTP ${response.statusCode}: ${response.body.slice(0, 200)}`);
  }
  let result;
  try { result = JSON.parse(response.body); }
  catch { throw new Error(`${context} 响应解析失败: ${response.body.slice(0, 200)}`); }
  if (result.errcode && result.errcode !== 0) {
    throw new Error(`${context} 微信错误 errcode=${result.errcode} errmsg=${result.errmsg}`);
  }
  return result;
}

// ---------- 凭据 + Token ----------

function loadCredentials() {
  let appId = process.env.WECHAT_APPID;
  let appSecret = process.env.WECHAT_APPSECRET;
  if ((!appId || !appSecret) && fs.existsSync(CREDENTIALS_FILE)) {
    const env = parseEnvFile(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    appId = appId || env.WECHAT_APPID;
    appSecret = appSecret || env.WECHAT_APPSECRET;
  }
  if (!appId || !appSecret) {
    throw new Error('缺少微信公众号凭据 (~/.credentials/wechat.env 或 env WECHAT_APPID/WECHAT_APPSECRET)');
  }
  return { appId, appSecret };
}

function getCachedToken() {
  if (!fs.existsSync(TOKEN_CACHE_FILE)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
    if (isTokenCacheValid(cached)) return cached.access_token;
  } catch {}
  return null;
}

async function getAccessToken() {
  const cached = getCachedToken();
  if (cached) return cached;

  const { appId, appSecret } = loadCredentials();
  const url =
    `${WECHAT_API_BASE}/cgi-bin/token` +
    `?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await httpsGet(url);
  const result = parseWechatResponse(response, '获取 Access Token');
  if (!result.access_token) {
    throw new Error(`获取 Access Token 失败：${JSON.stringify(result)}`);
  }
  const cache = buildTokenCache(result.access_token, result.expires_in || 7200);
  try { fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8'); }
  catch (err) { console.warn(`[draft] token 缓存写入失败: ${err.message}`); }
  return result.access_token;
}

// ---------- 默认封面（draft/add 必填 thumb_media_id） ----------

async function getDefaultThumbMediaId(accessToken) {
  const url =
    `${WECHAT_API_BASE}/cgi-bin/material/batchget_material` +
    `?access_token=${encodeURIComponent(accessToken)}`;
  const payload = JSON.stringify({ type: 'image', offset: 0, count: 1 });
  try {
    const response = await httpsPost(url, payload, { 'Content-Type': 'application/json' });
    const result = JSON.parse(response.body);
    if (result.item && result.item.length > 0) return result.item[0].media_id;
  } catch {}
  return null;
}

// ---------- 仅创建草稿 ----------

async function createDraft({ title, body, digest, author, thumbMediaId }, accessToken) {
  const article = {
    title,
    author: author || '',
    digest: digest || title.slice(0, 54),
    content: body,
    content_source_url: '',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
  if (thumbMediaId) article.thumb_media_id = thumbMediaId;

  const payload = JSON.stringify({ articles: [article] });
  const url = `${WECHAT_API_BASE}/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
  const response = await httpsPost(url, payload, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  const result = parseWechatResponse(response, 'draft/add');
  if (!result.media_id) {
    throw new Error(`draft/add 响应缺 media_id: ${JSON.stringify(result)}`);
  }
  return result.media_id;
}

// ---------- argv ----------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = flag => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  const has = flag => args.includes(flag);

  // 强制要求 --draft-only：作为安全闸门，明确表达调用方意图
  if (!has('--draft-only')) {
    throw new Error('publish-wechat-article-draft.cjs 必须传 --draft-only（防止误用）');
  }

  const title = get('--title');
  const bodyRaw = get('--body');
  if (!title) throw new Error('缺少 --title');
  if (!bodyRaw) throw new Error('缺少 --body');

  const body = bodyRaw.trim().startsWith('<') ? bodyRaw : textToHtml(bodyRaw);
  const digest = get('--digest') || title.slice(0, 54);
  const author = get('--author') || '';

  return { title, body, digest, author };
}

async function main() {
  let parsed;
  try { parsed = parseArgs(); }
  catch (err) {
    console.error(`[draft] 参数错误: ${err.message}`);
    process.exit(1);
  }

  try {
    const accessToken = await getAccessToken();

    // draft/add 要求 thumb_media_id；先尝试从素材库取默认封面
    let thumbMediaId = null;
    try { thumbMediaId = await getDefaultThumbMediaId(accessToken); }
    catch (err) { console.warn(`[draft] 取默认封面失败，继续无封面: ${err.message}`); }

    const mediaId = await createDraft({ ...parsed, thumbMediaId }, accessToken);

    // 最后一行 stdout 必须是 JSON（handler 解析最后一行）
    console.log(JSON.stringify({ ok: true, draft: true, mediaId }));
    process.exit(0);
  } catch (err) {
    console.error(`[draft] 失败: ${err.message}`);
    console.log(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createDraft, parseArgs };
