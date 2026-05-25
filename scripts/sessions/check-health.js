#!/usr/bin/env node
/**
 * Session 健康检查 — 检测所有平台 session 是否仍有效
 *
 * 从环境变量读取 GitHub Secrets 中的 cookies，
 * 通过 cookie 过期时间 + HTTP 检查两道验证，
 * 结果通过 Bark 推送到手机。
 *
 * 用法：
 *   node scripts/sessions/check-health.js
 *
 * 需要环境变量：
 *   DOUYIN_COOKIES           — JSON array
 *   DOUYIN_COOKIES_BURNER    — JSON array（可选）
 *   BARK_URL                 — https://api.day.app/<key>
 */

const https = require('https');
const fs = require('fs');

const BARK_URL = process.env.BARK_URL || 'https://api.day.app/QU7ktbzPJxZbNx9pEHcstW';
const FORCE_NOTIFY = process.env.FORCE_NOTIFY === 'true';

// ── 平台定义 ─────────────────────────────────────────────────────

const PLATFORMS = [
  {
    name: '抖音主号',
    secretEnv: 'DOUYIN_COOKIES',
    healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info',
    // 用于 HTTP 检查的 referer
    referer: 'https://creator.douyin.com/',
    // response 里表示已登录的字段（status_code=0 或有 user_info）
    validateResponse: (text) => {
      try {
        const d = JSON.parse(text);
        return d.status_code === 0 || !!d.user_info || !!d.creator_info;
      } catch { return false; }
    },
    // session 关键 cookie 名（用于过期时间检查）
    keyCookies: ['sessionid', 'sid_tt', 'sid_guard'],
  },
  {
    name: '抖音小号',
    secretEnv: 'DOUYIN_COOKIES_BURNER',
    healthUrl: 'https://creator.douyin.com/web/api/base/creator/user/info',
    referer: 'https://creator.douyin.com/',
    validateResponse: (text) => {
      try {
        const d = JSON.parse(text);
        return d.status_code === 0 || !!d.user_info || !!d.creator_info;
      } catch { return false; }
    },
    keyCookies: ['sessionid', 'sid_tt', 'sid_guard'],
    optional: true,  // 没有 secret 时不报错
  },
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
    const mod = url.startsWith('https') ? https : require('http');
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
  const encoded = `${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  const url = `${BARK_URL}/${encoded}?group=ZenithJoy`;
  return new Promise((resolve) => {
    https.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', () => resolve(0));
  });
}

// ── 检查单个平台 ─────────────────────────────────────────────────

async function checkPlatform(platform) {
  const raw = process.env[platform.secretEnv];
  if (!raw) {
    if (platform.optional) return { name: platform.name, status: 'skip', reason: '无 secret' };
    return { name: platform.name, status: 'error', reason: 'Secret 未配置' };
  }

  let cookies;
  try {
    cookies = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    return { name: platform.name, status: 'error', reason: `JSON 解析失败: ${e.message}` };
  }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    return { name: platform.name, status: 'expired', reason: 'Cookie 数组为空' };
  }

  // ── 检查 1：关键 cookie 过期时间 ──
  const now = Math.floor(Date.now() / 1000);
  for (const keyName of platform.keyCookies) {
    const c = cookies.find(x => x.name === keyName);
    if (!c) continue;
    if (c.expires && c.expires > 0 && c.expires < now) {
      const expiredAgo = Math.floor((now - c.expires) / 3600);
      return {
        name: platform.name,
        status: 'expired',
        reason: `${keyName} 已过期 ${expiredAgo} 小时前`,
      };
    }
    // 7 天内即将过期
    if (c.expires && c.expires > 0 && c.expires - now < 7 * 86400) {
      const daysLeft = Math.floor((c.expires - now) / 86400);
      return {
        name: platform.name,
        status: 'warning',
        reason: `${keyName} 还有 ${daysLeft} 天过期`,
        cookieCount: cookies.length,
      };
    }
  }

  // ── 检查 2：HTTP 调用验证 ──
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const resp = await httpGet(platform.healthUrl, cookieStr, platform.referer);

  if (resp.status === 0) {
    // 网络失败，只用 cookie 时间判断（已通过）
    return { name: platform.name, status: 'ok', reason: 'HTTP 超时但 cookie 时间有效', cookieCount: cookies.length };
  }

  if (resp.status === 401 || resp.status === 403) {
    return { name: platform.name, status: 'expired', reason: `HTTP ${resp.status}` };
  }

  // 重定向到登录页
  if (resp.status >= 300 && resp.status < 400) {
    const loc = resp.headers?.location || '';
    if (loc.includes('login') || loc.includes('passport')) {
      return { name: platform.name, status: 'expired', reason: `重定向到登录页: ${loc.substring(0, 60)}` };
    }
  }

  if (resp.status === 200 && platform.validateResponse(resp.body)) {
    return { name: platform.name, status: 'ok', reason: 'HTTP 200 + 响应有效', cookieCount: cookies.length };
  }

  // 200 但响应不符合预期（可能是风控页面）
  return {
    name: platform.name,
    status: 'warning',
    reason: `HTTP ${resp.status}，响应未通过校验`,
    cookieCount: cookies.length,
  };
}

// ── 主逻辑 ───────────────────────────────────────────────────────

async function main() {
  console.log(`[session-health] 开始巡检 @ ${new Date().toISOString()}`);

  const results = [];
  for (const p of PLATFORMS) {
    console.log(`[session-health] 检查 ${p.name}...`);
    const r = await checkPlatform(p);
    console.log(`  ${r.status === 'ok' ? '✅' : r.status === 'skip' ? '⏭️' : r.status === 'warning' ? '⚠️' : '❌'} ${r.name}: ${r.reason}`);
    results.push({ ...r, checkedAt: new Date().toISOString() });
  }

  // 写报告文件
  fs.writeFileSync('session-health-report.json', JSON.stringify({ results, checkedAt: new Date().toISOString() }, null, 2));

  // 统计
  const expired = results.filter(r => r.status === 'expired');
  const warnings = results.filter(r => r.status === 'warning');
  const ok = results.filter(r => r.status === 'ok');

  const needNotify = FORCE_NOTIFY || expired.length > 0 || warnings.length > 0;

  if (!needNotify) {
    console.log(`[session-health] 全部正常（${ok.length} 个），无需通知`);
    return;
  }

  // Bark 通知
  let title, body;
  if (expired.length > 0) {
    title = `⚠️ Session过期 需扫码`;
    const expiredNames = expired.map(r => r.name).join('、');
    body = `${expiredNames} session已过期\n请在xian-rog重新登录后运行:\nbash scripts/sessions/sync-from-xian-rog.sh`;
  } else if (warnings.length > 0) {
    title = `📅 Session即将过期`;
    body = warnings.map(r => `${r.name}: ${r.reason}`).join('\n');
  } else {
    title = `✅ Session全部正常`;
    body = ok.map(r => `${r.name}(${r.cookieCount || '?'}个cookie)`).join('、');
  }

  console.log(`[session-health] 发送 Bark: ${title}`);
  await barkNotify(title, body);

  // 过期时 exit 1 让 CI 显示 fail（可见性）
  if (expired.length > 0) {
    console.error(`[session-health] ${expired.length} 个平台 session 已过期`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('[session-health] 崩溃:', e.message);
  process.exit(1);
});
