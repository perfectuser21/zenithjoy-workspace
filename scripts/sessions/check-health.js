#!/usr/bin/env node
/**
 * Session 健康检查 — 检测所有平台 session 是否仍有效
 *
 * 从环境变量读取 GitHub Secrets 中的 cookies，
 * 通过 cookie 过期时间 + HTTP 检查两道验证（可用 SKIP_HTTP_CHECK=true 跳过 HTTP），
 * 结果通过 Bark + 飞书 Bot 推送告警。
 *
 * 用法：
 *   SKIP_HTTP_CHECK=true node scripts/sessions/check-health.js
 *
 * 输出：session-health-report.json（JSON array，PRD schema）
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BARK_URL = process.env.BARK_URL || '';
const FORCE_NOTIFY = process.env.FORCE_NOTIFY === 'true';
const SKIP_HTTP_CHECK = process.env.SKIP_HTTP_CHECK === 'true';
const FEISHU_BOT_WEBHOOK = process.env.FEISHU_BOT_WEBHOOK || '';

// ── validate 函数 ─────────────────────────────────────────────────

const validateDouyin = (text) => {
  try {
    const d = JSON.parse(text);
    return d !== null && typeof d === 'object' && !Array.isArray(d)
      && (!Object.hasOwn(d, 'status_code') || d.status_code === 0)
      && (d.status_code === 0 || !!d.user_info || !!d.creator_info);
  } catch { return false; }
};
const validateKuaishou = (text) => {
  try {
    const d = JSON.parse(text);
    return d !== null && typeof d === 'object' && !Array.isArray(d)
      && (!Object.hasOwn(d, 'result') || d.result === 1)
      && (d.result === 1 || !!d.data);
  } catch { return false; }
};
const validateXhs = (text) => {
  try {
    const d = JSON.parse(text);
    return d !== null && typeof d === 'object' && !Array.isArray(d)
      && (!Object.hasOwn(d, 'code') || d.code === 0)
      && (!Object.hasOwn(d, 'success') || d.success === true)
      && (d.code === 0 || d.success === true);
  } catch { return false; }
};
const validateTrue = () => true;

// ── 平台定义（8×4=32 平台账号 + 3 API key = 35 条目）────────────────

export const PLATFORMS = [
  // ── 抖音（4 账号）────────────────────────────────────────────────
  { platform: '抖音主号',  secretEnv: 'DOUYIN_COOKIES',  healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info', referer: 'https://creator.douyin.com/', keyCookies: ['sessionid', 'sid_tt', 'sid_guard'], validateResponse: validateDouyin },
  { platform: '抖音小号1', secretEnv: 'DOUYIN_SUB_1', healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info', referer: 'https://creator.douyin.com/', keyCookies: ['sessionid', 'sid_tt', 'sid_guard'], validateResponse: validateDouyin },
  { platform: '抖音小号2', secretEnv: 'DOUYIN_SUB_2', healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info', referer: 'https://creator.douyin.com/', keyCookies: ['sessionid', 'sid_tt', 'sid_guard'], validateResponse: validateDouyin },
  { platform: '抖音小号3', secretEnv: 'DOUYIN_SUB_3', healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info', referer: 'https://creator.douyin.com/', keyCookies: ['sessionid', 'sid_tt', 'sid_guard'], validateResponse: validateDouyin },
  // ── 快手（4 账号）────────────────────────────────────────────────
  { platform: '快手主号',  secretEnv: 'KUAISHOU_COOKIES',  healthUrl: 'https://cp.kuaishou.com/account/api/user/info', referer: 'https://cp.kuaishou.com/', keyCookies: ['userId', 'kuaishou_st', 'passToken'], validateResponse: validateKuaishou },
  { platform: '快手小号1', secretEnv: 'KUAISHOU_SUB_1', healthUrl: 'https://cp.kuaishou.com/account/api/user/info', referer: 'https://cp.kuaishou.com/', keyCookies: ['userId', 'kuaishou_st', 'passToken'], validateResponse: validateKuaishou },
  { platform: '快手小号2', secretEnv: 'KUAISHOU_SUB_2', healthUrl: 'https://cp.kuaishou.com/account/api/user/info', referer: 'https://cp.kuaishou.com/', keyCookies: ['userId', 'kuaishou_st', 'passToken'], validateResponse: validateKuaishou },
  { platform: '快手小号3', secretEnv: 'KUAISHOU_SUB_3', healthUrl: 'https://cp.kuaishou.com/account/api/user/info', referer: 'https://cp.kuaishou.com/', keyCookies: ['userId', 'kuaishou_st', 'passToken'], validateResponse: validateKuaishou },
  // ── 小红书（4 账号）──────────────────────────────────────────────
  { platform: '小红书主号',  secretEnv: 'XIAOHONGSHU_COOKIES',  healthUrl: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/cre_info', referer: 'https://creator.xiaohongshu.com/', keyCookies: ['web_session', 'galaxy_creator_session_info'], validateResponse: validateXhs },
  { platform: '小红书小号1', secretEnv: 'XIAOHONGSHU_SUB_1', healthUrl: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/cre_info', referer: 'https://creator.xiaohongshu.com/', keyCookies: ['web_session', 'galaxy_creator_session_info'], validateResponse: validateXhs },
  { platform: '小红书小号2', secretEnv: 'XIAOHONGSHU_SUB_2', healthUrl: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/cre_info', referer: 'https://creator.xiaohongshu.com/', keyCookies: ['web_session', 'galaxy_creator_session_info'], validateResponse: validateXhs },
  { platform: '小红书小号3', secretEnv: 'XIAOHONGSHU_SUB_3', healthUrl: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/cre_info', referer: 'https://creator.xiaohongshu.com/', keyCookies: ['web_session', 'galaxy_creator_session_info'], validateResponse: validateXhs },
  // ── 视频号（4 账号）──────────────────────────────────────────────
  { platform: '视频号主号',  secretEnv: 'SHIPINHAO_COOKIES',  healthUrl: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_info', referer: 'https://channels.weixin.qq.com/', keyCookies: ['slave_sid', 'slave_user'], validateResponse: validateTrue },
  { platform: '视频号小号1', secretEnv: 'SHIPINHAO_SUB_1', healthUrl: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_info', referer: 'https://channels.weixin.qq.com/', keyCookies: ['slave_sid', 'slave_user'], validateResponse: validateTrue },
  { platform: '视频号小号2', secretEnv: 'SHIPINHAO_SUB_2', healthUrl: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_info', referer: 'https://channels.weixin.qq.com/', keyCookies: ['slave_sid', 'slave_user'], validateResponse: validateTrue },
  { platform: '视频号小号3', secretEnv: 'SHIPINHAO_SUB_3', healthUrl: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_info', referer: 'https://channels.weixin.qq.com/', keyCookies: ['slave_sid', 'slave_user'], validateResponse: validateTrue },
  // ── 头条（4 账号）────────────────────────────────────────────────
  { platform: '头条主号',  secretEnv: 'TOUTIAO_COOKIES',  healthUrl: 'https://mp.toutiao.com/mp/agw/creator_center/homepage/userinfo', referer: 'https://mp.toutiao.com/', keyCookies: ['sso_uid_tt', 'sessionid'], validateResponse: validateTrue },
  { platform: '头条小号1', secretEnv: 'TOUTIAO_SUB_1', healthUrl: 'https://mp.toutiao.com/mp/agw/creator_center/homepage/userinfo', referer: 'https://mp.toutiao.com/', keyCookies: ['sso_uid_tt', 'sessionid'], validateResponse: validateTrue },
  { platform: '头条小号2', secretEnv: 'TOUTIAO_SUB_2', healthUrl: 'https://mp.toutiao.com/mp/agw/creator_center/homepage/userinfo', referer: 'https://mp.toutiao.com/', keyCookies: ['sso_uid_tt', 'sessionid'], validateResponse: validateTrue },
  { platform: '头条小号3', secretEnv: 'TOUTIAO_SUB_3', healthUrl: 'https://mp.toutiao.com/mp/agw/creator_center/homepage/userinfo', referer: 'https://mp.toutiao.com/', keyCookies: ['sso_uid_tt', 'sessionid'], validateResponse: validateTrue },
  // ── 微博（4 账号）────────────────────────────────────────────────
  { platform: '微博主号',  secretEnv: 'WEIBO_COOKIES',  healthUrl: 'https://weibo.com/ajax/profile/me', referer: 'https://weibo.com/', keyCookies: ['SUB', 'SUBP'], validateResponse: validateTrue },
  { platform: '微博小号1', secretEnv: 'WEIBO_SUB_1', healthUrl: 'https://weibo.com/ajax/profile/me', referer: 'https://weibo.com/', keyCookies: ['SUB', 'SUBP'], validateResponse: validateTrue },
  { platform: '微博小号2', secretEnv: 'WEIBO_SUB_2', healthUrl: 'https://weibo.com/ajax/profile/me', referer: 'https://weibo.com/', keyCookies: ['SUB', 'SUBP'], validateResponse: validateTrue },
  { platform: '微博小号3', secretEnv: 'WEIBO_SUB_3', healthUrl: 'https://weibo.com/ajax/profile/me', referer: 'https://weibo.com/', keyCookies: ['SUB', 'SUBP'], validateResponse: validateTrue },
  // ── 知乎（4 账号）────────────────────────────────────────────────
  { platform: '知乎主号',  secretEnv: 'ZHIHU_COOKIES',  healthUrl: 'https://www.zhihu.com/api/v4/me', referer: 'https://www.zhihu.com/', keyCookies: ['z_c0'], validateResponse: validateTrue },
  { platform: '知乎小号1', secretEnv: 'ZHIHU_SUB_1', healthUrl: 'https://www.zhihu.com/api/v4/me', referer: 'https://www.zhihu.com/', keyCookies: ['z_c0'], validateResponse: validateTrue },
  { platform: '知乎小号2', secretEnv: 'ZHIHU_SUB_2', healthUrl: 'https://www.zhihu.com/api/v4/me', referer: 'https://www.zhihu.com/', keyCookies: ['z_c0'], validateResponse: validateTrue },
  { platform: '知乎小号3', secretEnv: 'ZHIHU_SUB_3', healthUrl: 'https://www.zhihu.com/api/v4/me', referer: 'https://www.zhihu.com/', keyCookies: ['z_c0'], validateResponse: validateTrue },
  // ── 公众号（4 账号）──────────────────────────────────────────────
  { platform: '公众号主号',  secretEnv: 'GONGZHONGHAO_COOKIES',  healthUrl: 'https://mp.weixin.qq.com/cgi-bin/homepage', referer: 'https://mp.weixin.qq.com/', keyCookies: ['token', 'ticket'], validateResponse: validateTrue },
  { platform: '公众号小号1', secretEnv: 'GONGZHONGHAO_SUB_1', healthUrl: 'https://mp.weixin.qq.com/cgi-bin/homepage', referer: 'https://mp.weixin.qq.com/', keyCookies: ['token', 'ticket'], validateResponse: validateTrue },
  { platform: '公众号小号2', secretEnv: 'GONGZHONGHAO_SUB_2', healthUrl: 'https://mp.weixin.qq.com/cgi-bin/homepage', referer: 'https://mp.weixin.qq.com/', keyCookies: ['token', 'ticket'], validateResponse: validateTrue },
  { platform: '公众号小号3', secretEnv: 'GONGZHONGHAO_SUB_3', healthUrl: 'https://mp.weixin.qq.com/cgi-bin/homepage', referer: 'https://mp.weixin.qq.com/', keyCookies: ['token', 'ticket'], validateResponse: validateTrue },
  // ── API Keys（3 条，expiresAt 永远为 null）───────────────────────
  { platform: '飞书 API Key',   secretEnv: 'FEISHU_API_KEY',  type: 'api_key' },
  { platform: 'Notion API Key', secretEnv: 'NOTION_API_KEY',  type: 'api_key' },
  { platform: '企微 API Key',   secretEnv: 'WECOM_API_KEY',   type: 'api_key' },
];

// ── 工具函数 ─────────────────────────────────────────────────────

async function httpGet(url, cookieStr, referer) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': referer || url,
        'Accept': 'application/json, text/plain, */*',
      },
      timeout: 8000,
    };
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ status: 0, body: '', error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', error: 'timeout' }); });
  });
}

async function barkNotify(title, body) {
  if (!BARK_URL) return;
  const encoded = `${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  const url = `${BARK_URL}/${encoded}?group=ZenithJoy`;
  return new Promise((resolve) => {
    https.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', () => resolve(0));
  });
}

async function sendFeishuAlert(title, content) {
  if (!FEISHU_BOT_WEBHOOK) return;
  const payload = JSON.stringify({
    msg_type: 'text',
    content: { text: `${title}\n${content}` },
  });
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(0), 3000);
  });
  const request = new Promise((resolve) => {
    try {
      const u = new URL(FEISHU_BOT_WEBHOOK);
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      const req = https.request(options, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write(payload);
      req.end();
    } catch (_e) {
      resolve(0);
    }
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (_e) {
    return 0;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 检查单个平台 ─────────────────────────────────────────────────

export async function checkPlatform(p, { env = process.env, skipHttpCheck = SKIP_HTTP_CHECK, request = httpGet } = {}) {
  const checkedAt = new Date().toISOString();

  if (p.type === 'api_key') {
    const raw = env[p.secretEnv];
    let status = 'ok';
    if (!raw) {
      status = 'missing';
    }
    return { platform: p.platform, secretEnv: p.secretEnv, status, checkedAt, expiresAt: null };
  }

  const raw = env[p.secretEnv];
  if (!raw) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'missing', checkedAt, expiresAt: null };
  }

  let cookies;
  try {
    const state = JSON.parse(raw.replace(/^﻿/, ''));
    cookies = Array.isArray(state) ? state : state?.cookies;
  } catch (_e) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'invalid', checkedAt, expiresAt: null };
  }

  if (!Array.isArray(cookies) || !cookies.every(cookie => cookie && typeof cookie === 'object'
    && typeof cookie.name === 'string' && cookie.name.trim() && typeof cookie.value === 'string')) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'invalid', checkedAt, expiresAt: null };
  }

  if (cookies.length === 0) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'expired', checkedAt, expiresAt: null };
  }

  // ── 检查 1：关键 cookie 过期时间 ──
  const now = Math.floor(Date.now() / 1000);
  let earliestExpiry = null;
  for (const keyName of p.keyCookies) {
    const c = cookies.find(x => x.name === keyName);
    if (!c || !c.expires || c.expires <= 0) continue;
    if (c.expires < now) {
      return {
        platform: p.platform, secretEnv: p.secretEnv, status: 'expired', checkedAt,
        expiresAt: new Date(c.expires * 1000).toISOString(),
      };
    }
    if (earliestExpiry === null || c.expires < earliestExpiry) {
      earliestExpiry = c.expires;
    }
  }

  const expiresAt = earliestExpiry ? new Date(earliestExpiry * 1000).toISOString() : null;

  if (skipHttpCheck) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'unknown', checkedAt, expiresAt };
  }

  // ── 检查 2：HTTP 调用验证 ──
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const resp = await request(p.healthUrl, cookieStr, p.referer);

  if (resp.status === 0) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'unknown', checkedAt, expiresAt };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'expired', checkedAt, expiresAt };
  }

  if (resp.status >= 300 && resp.status < 400) {
    const loc = resp.headers?.location || '';
    if (loc.includes('login') || loc.includes('passport')) {
      return { platform: p.platform, secretEnv: p.secretEnv, status: 'expired', checkedAt, expiresAt };
    }
  }

  if (resp.status === 200 && p.validateResponse(resp.body)) {
    return { platform: p.platform, secretEnv: p.secretEnv, status: 'ok', checkedAt, expiresAt };
  }

  return { platform: p.platform, secretEnv: p.secretEnv, status: 'unknown', checkedAt, expiresAt };
}

// ── DB 回写 ──────────────────────────────────────────────────────

export async function postSessionStatus(results, { env = process.env } = {}) {
  const apiBase = env.OPERATOR_API_URL || '';
  const secret = env.ZENITHJOY_INTERNAL_TOKEN || '';
  // The status API and Dashboard expose eight main accounts. Subaccounts and
  // API-key presence remain in the 35-slot report; they cannot overwrite a main.
  const mainPlatforms = { DOUYIN_COOKIES: 'douyin', KUAISHOU_COOKIES: 'kuaishou',
    XIAOHONGSHU_COOKIES: 'xiaohongshu', SHIPINHAO_COOKIES: 'shipinhao',
    TOUTIAO_COOKIES: 'toutiao', WEIBO_COOKIES: 'weibo',
    ZHIHU_COOKIES: 'zhihu', GONGZHONGHAO_COOKIES: 'gongzhonghao' };
  const updates = results
    .filter(r => mainPlatforms[r.secretEnv] && (r.status === 'ok' || r.status === 'expired'))
    .map(r => ({ platform: mainPlatforms[r.secretEnv], status: r.status === 'ok' ? 'active' : r.status, checkedAt: r.checkedAt }));
  if (updates.length === 0) return;
  const missing = [!apiBase && 'OPERATOR_API_URL', !secret && 'ZENITHJOY_INTERNAL_TOKEN'].filter(Boolean);
  if (missing.length > 0) {
    console.error('[session-health] missing required writeback configuration: ' + missing.join(', '));
    return 0;
  }
  const payload = JSON.stringify({ updates });
  const url = `${apiBase}/api/operator/sessions/status`;
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const options = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Internal-Token': secret,
        },
      };
      const mod = url.startsWith('https') ? https : http;
      const req = mod.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('error', () => resolve(0));
        res.on('end', () => {
          if (!(res.statusCode >= 200 && res.statusCode < 300)) return resolve(res.statusCode);
          try {
            const acknowledgement = JSON.parse(body);
            resolve(acknowledgement.ok === true && acknowledgement.updated === updates.length ? res.statusCode : 0);
          } catch { resolve(0); }
        });
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(0); });
      req.on('error', () => resolve(0));
      req.write(payload);
      req.end();
    } catch (_e) {
      resolve(0);
    }
  });
}

// ── 主逻辑 ───────────────────────────────────────────────────────

export async function main() {
  const configuredRequired = process.env.SESSION_HEALTH_REQUIRED_ACCOUNTS;
  let required = null;
  if (configuredRequired !== undefined) {
    const names = configuredRequired.split(',').map(name => name.trim());
    const known = new Set(PLATFORMS.filter(p => p.type !== 'api_key').map(p => p.secretEnv));
    if (names.some(name => !name || !known.has(name)) || new Set(names).size !== names.length) {
      throw new Error('SESSION_HEALTH_REQUIRED_ACCOUNTS must be a nonempty unique list of known account secret names');
    }
    required = new Set(names);
  }
  console.log(`[session-health] 开始巡检 @ ${new Date().toISOString()}`);

  const results = [];
  for (const p of PLATFORMS) {
    console.log(`[session-health] 检查 ${p.platform}...`);
    const r = await checkPlatform(p);
    let icon = '⚠️';
    if (r.status === 'ok') icon = '✅';
    else if (r.status === 'expired') icon = '❌';
    else if (r.status === 'missing') icon = '⏭️';
    console.log(`  ${icon} ${r.platform}: ${r.status}`);
    results.push(r);
  }

  fs.writeFileSync('session-health-report.json', JSON.stringify(results, null, 2));

  const expired = results.filter(r => r.status === 'expired');
  const missing = results.filter(r => r.status === 'missing' && (!required || required.has(r.secretEnv)));
  const optionalMissing = results.filter(r => r.status === 'missing' && required && !required.has(r.secretEnv));
  const uncertain = results.filter(r => r.status === 'unknown' || r.status === 'invalid');
  const ok = results.filter(r => r.status === 'ok');
  const verifiedAccounts = ok.filter(r => PLATFORMS.some(p => p.secretEnv === r.secretEnv && p.type !== 'api_key'));
  if (missing.length > 0) {
    console.error(`[session-health] ${missing.length} 个必需配置缺失`);
    process.exitCode = 1;
  }
  if (verifiedAccounts.length === 0) {
    console.error('[session-health] 没有任何账号通过实际健康检查');
    process.exitCode = 1;
  }

  // missing 不等于 ok — 有 missing 的平台也需要告警
  const needNotify = FORCE_NOTIFY || expired.length > 0 || missing.length > 0 || uncertain.length > 0;

  // 回写 DB（无论是否需要通知都执行）
  const writebackStatus = await postSessionStatus(results);
  const writebackFailed = writebackStatus !== undefined && !(writebackStatus >= 200 && writebackStatus < 300);
  if (writebackFailed) {
    console.error(`[session-health] Session状态回写失败（HTTP ${writebackStatus || 'network error'}）`);
    process.exitCode = 1;
  }

  if (!needNotify) {
    if (writebackFailed) {
      console.log(`[session-health] Session检测完成（ok=${ok.length}），状态回写失败`);
    } else {
      console.log(verifiedAccounts.length ? `[session-health] 已检查账号通过（ok=${verifiedAccounts.length}, optional_missing=${optionalMissing.length}），无需通知` : '[session-health] 未验证任何账号，巡检失败');
    }
    return;
  }

  let title, body;
  if (expired.length > 0) {
    title = `⚠️ Session过期 需扫码`;
    const expiredNames = expired.map(r => r.platform).join('、');
    body = `${expiredNames} session已过期\n请在xian-rog重新登录后运行:\nbash scripts/sessions/sync-from-xian-rog.sh`;
  } else if (missing.length > 0) {
    title = `⚠️ Session缺失`;
    const missingNames = missing.map(r => r.platform).join('、');
    body = `${missingNames} 尚未绑定，请完成初始登录`;
  } else if (uncertain.length > 0) {
    title = `⚠️ Session状态未确认`;
    body = `${uncertain.map(r => r.platform).join('、')} 检测失败或配置无效，请检查巡检报告后重试`;
  } else {
    title = `✅ Session全部正常`;
    body = ok.map(r => r.platform).join('、');
  }
  if (uncertain.length > 0 && (expired.length > 0 || missing.length > 0)) {
    body += `\n状态未确认: ${uncertain.map(r => r.platform).join('、')}`;
  }

  console.log(`[session-health] 发送告警: ${title}`);
  const deliveries = await Promise.all([
    barkNotify(title, body),
    sendFeishuAlert(title, body),
  ]);
  if (deliveries.some(status => status !== undefined && !(status >= 200 && status < 300))) {
    console.error('[session-health] 告警发送失败，请检查通知通道');
    process.exitCode = 1;
  }
  if (uncertain.length > 0) {
    console.error(`[session-health] ${uncertain.length} 个平台 session 状态未确认`);
    process.exitCode = 1;
  }

  if (expired.length > 0) {
    console.error(`[session-health] ${expired.length} 个平台 session 已过期`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error('[session-health] 崩溃:', e.message);
    process.exitCode = 1;
  });
}
