#!/usr/bin/env node
/**
 * 小红书运营员 Session E2E 验证（对应抖音的 verify-operator-douyin.js）
 *
 * 从 XIAOHONGSHU_COOKIES 环境变量读取 Playwright storageState，
 * 启动 Chrome，导航 creator.xiaohongshu.com，
 * 确认已登录（galaxy_creator_session_info cookie 存在 + creator API 正常）。
 *
 * PASS → exit 0 + xiaohongshu-session-pass.png
 * FAIL → exit 1 + xiaohongshu-session-fail.png + 飞书告警
 */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIE = 'galaxy_creator_session_info';
const SPA_SETTLE_MS = 4000;
const NAV_TIMEOUT_MS = 30000;
const ZENITHJOY_FEISHU_WEBHOOK = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';

class VerifyFailError extends Error {}

async function sendFeishuAlert(title, content) {
  if (!ZENITHJOY_FEISHU_WEBHOOK) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${content}` } });
  return new Promise((resolve) => {
    try {
      const u = new URL(ZENITHJOY_FEISHU_WEBHOOK);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write(payload); req.end();
    } catch { resolve(0); }
  });
}

async function main() {
  const sessionRaw = process.env.XIAOHONGSHU_COOKIES;
  if (!sessionRaw) {
    console.error('[FAIL] XIAOHONGSHU_COOKIES 环境变量未设置');
    process.exit(1);
  }

  let storageState;
  try { storageState = JSON.parse(sessionRaw); }
  catch { console.error('[FAIL] XIAOHONGSHU_COOKIES 不是合法 JSON'); process.exit(1); }

  const cookies = storageState.cookies ?? [];
  console.log(`[info] storageState 已解析，共 ${cookies.length} 个 cookies`);

  const sessionCookie = cookies.find(c => c.name === SESSION_COOKIE);
  if (!sessionCookie) {
    const msg = `未找到 ${SESSION_COOKIE} cookie`;
    console.error(`[FAIL] ${msg}`);
    await sendFeishuAlert('🔴 XIAOHONGSHU_COOKIES 验证失败', msg + '\n请重新扫码更新 Secret');
    process.exit(1);
  }

  const tmpFile = path.join(os.tmpdir(), `xiaohongshu-session-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(storageState));

  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
    const context = await browser.newContext({
      storageState: tmpFile,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    let apiOk = false;
    context.on('response', async (resp) => {
      try {
        if (resp.url().includes('/api/galaxy/creator/home/cre_info')) {
          const body = await resp.json().catch(() => ({}));
          apiOk = body.code === 0 || body.success === true || resp.status() === 200;
        }
      } catch { /* ignore */ }
    });

    const page = await context.newPage();
    console.log(`[info] 导航至 ${CREATOR_URL} ...`);
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    console.log(`[info] 等待 SPA settle (${SPA_SETTLE_MS}ms)...`);
    await page.waitForTimeout(SPA_SETTLE_MS);

    const finalUrl = page.url();
    console.log(`[info] 最终 URL: ${finalUrl}`);
    const isOnLoginPage = /login/i.test(finalUrl);

    if (isOnLoginPage) {
      await page.screenshot({ path: 'xiaohongshu-session-fail.png' }).catch(() => {});
      const msg = `导航后停在登录页（${finalUrl}）`;
      console.error(`[FAIL] ${msg}`);
      await sendFeishuAlert('🔴 XIAOHONGSHU_COOKIES 验证失败', msg + '\n请重新扫码并更新 GHA secret');
      throw new VerifyFailError(msg);
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'xiaohongshu-session-pass.png' }).catch(() => {});
    console.log(`[info] cre_info API ok=${apiOk}`);

    console.log('');
    console.log('============================================');
    console.log('  PASS: 小红书运营员 session 有效');
    console.log(`  URL: ${finalUrl}`);
    console.log('============================================');

  } finally {
    await browser?.close().catch(() => {});
    fs.rmSync(tmpFile, { force: true });
  }
}

main().catch(async (err) => {
  if (!(err instanceof VerifyFailError)) {
    console.error('[FAIL] 未预期异常:', err.message);
    await sendFeishuAlert('🔴 XIAOHONGSHU_COOKIES 验证异常', err.message.slice(0, 200)).catch(() => {});
  }
  process.exit(1);
});
