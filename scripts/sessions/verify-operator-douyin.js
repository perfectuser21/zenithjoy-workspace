#!/usr/bin/env node
/**
 * 抖音运营员 Session E2E 验证
 *
 * 从 DOUYIN_OPERATOR_SESSION 环境变量读取 Playwright storageState，
 * 启动 headless Chrome，导航到 creator.douyin.com，
 * 确认已登录（URL 不含 /login + creator user/info API 返回正常）。
 *
 * PASS → exit 0 + douyin-session-pass.png
 * FAIL → exit 1 + douyin-session-fail.png + Bark + 飞书告警
 */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

// playwright 安装在 services/agent/node_modules，用 createRequire 从该路径解析
const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.douyin.com/creator-micro/home';
const SPA_SETTLE_MS = 3000;
const NAV_TIMEOUT_MS = 30000;
const BARK_URL = process.env.BARK_URL || 'https://api.day.app/QU7ktbzPJxZbNx9pEHcstW';
const FEISHU_BOT_WEBHOOK = process.env.FEISHU_BOT_WEBHOOK || '';
class VerifyFailError extends Error {}

async function barkNotify(title, body) {
  const encoded = `${encodeURIComponent(title)}/${encodeURIComponent(body)}`;
  const url = `${BARK_URL}/${encoded}?group=ZenithJoy`;
  return new Promise((resolve) => {
    https.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
  });
}

async function sendFeishuAlert(title, content) {
  if (!FEISHU_BOT_WEBHOOK) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${content}` } });
  return new Promise((resolve) => {
    try {
      const u = new URL(FEISHU_BOT_WEBHOOK);
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      };
      const req = https.request(options, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write(payload);
      req.end();
    } catch { resolve(0); }
  });
}

async function main() {
  const sessionRaw = process.env.DOUYIN_OPERATOR_SESSION;
  if (!sessionRaw) {
    console.error('[FAIL] DOUYIN_OPERATOR_SESSION 环境变量未设置');
    process.exit(1);
  }

  let storageState;
  try {
    storageState = JSON.parse(sessionRaw);
  } catch {
    console.error('[FAIL] DOUYIN_OPERATOR_SESSION 不是合法 JSON');
    process.exit(1);
  }

  const cookies = storageState.cookies ?? [];
  console.log(`[info] storageState 已解析，共 ${cookies.length} 个 cookies`);

  // 快速过期检查（不用启动浏览器）
  const sessionid = cookies.find(c => c.name === 'sessionid');
  if (sessionid?.expires) {
    const exp = new Date(sessionid.expires * 1000);
    if (exp < new Date()) {
      const msg = `sessionid 已过期（${exp.toISOString().slice(0,10)}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', msg + ' — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      process.exit(1);
    }
    console.log(`[info] sessionid 有效期至 ${new Date(sessionid.expires * 1000).toISOString().slice(0,10)}`);
  }

  // 写临时 storageState 文件
  const tmpFile = path.join(os.tmpdir(), `douyin-operator-session-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(storageState));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: tmpFile,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    // 拦截 user/info API
    let apiStatus = null;
    let apiOk = false;
    context.on('response', async (resp) => {
      try {
        if (resp.url().includes('/web/api/base/creator/user/info')) {
          apiStatus = resp.status();
          try {
            const body = await resp.json();
            apiOk = body.status_code === 0 || !!body.user_info || !!body.creator_info;
          } catch { apiOk = resp.status() === 200; }
        }
      } catch { /* 静默忽略 context 关闭等异常 */ }
    });

    const page = await context.newPage();
    console.log(`[info] 导航至 ${CREATOR_URL} ...`);
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    console.log(`[info] 等待 SPA settle (${SPA_SETTLE_MS}ms)...`);
    await page.waitForTimeout(SPA_SETTLE_MS);

    const finalUrl = page.url();
    console.log(`[info] 最终 URL: ${finalUrl}`);

    const isOnLoginPage = /\/login(\b|\/|$)/i.test(finalUrl);

    if (isOnLoginPage) {
      await page.screenshot({ path: 'douyin-session-fail.png', fullPage: false }).catch(() => {});
      const msg = `导航后停在登录页（${finalUrl}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', 'CI 验证失败 — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      throw new VerifyFailError(msg);
    }

    // 等待 API 响应
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'douyin-session-pass.png', fullPage: false }).catch(() => {});

    console.log(`[info] user/info API: status=${apiStatus ?? '未捕获'} ok=${apiOk}`);

    if (apiStatus !== null && !apiOk) {
      const msg = `user/info API 返回异常（HTTP ${apiStatus}）`;
      console.error(`[FAIL] ${msg}`);
      await Promise.allSettled([
        barkNotify('抖音运营员 Session 失效', msg + ' — 请重新扫码'),
        sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证失败', msg + '\n请重新扫码并更新 GHA secret'),
      ]);
      throw new VerifyFailError(msg);
    }

    console.log('');
    console.log('============================================');
    console.log('  PASS: 抖音运营员 session 有效');
    console.log(`  URL: ${finalUrl}`);
    if (apiStatus) console.log(`  API: ${apiStatus} ok=${apiOk}`);
    console.log('============================================');

  } finally {
    await browser?.close();
    fs.rmSync(tmpFile, { force: true });
  }
}

main().catch(async (err) => {
  if (!(err instanceof VerifyFailError)) {
    // 预期 FAIL 已在内部打印并告警，这里只处理意外异常
    console.error('[FAIL] 未预期异常:', err.message);
    await Promise.allSettled([
      barkNotify('抖音运营员 Session 验证异常', err.message.slice(0, 100)),
      sendFeishuAlert('🔴 DOUYIN_OPERATOR_SESSION 验证异常', err.message.slice(0, 200)),
    ]).catch(() => {});
  }
  process.exit(1);
});
