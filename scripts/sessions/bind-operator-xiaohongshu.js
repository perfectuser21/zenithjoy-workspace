#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v3
 * - 导航后 dump 登录区可点击元素（调试用）
 * - 尝试多种方式触发 QR 登录
 * - session 写 artifact 文件由 Claude 本地 gh secret set
 */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import https from 'https';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIES = ['web_session', 'galaxy_creator_session_info'];
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 1500;

async function sendFeishuQrCard(buf) {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) { console.log('[飞书] 未配置'); return; }
  try {
    const { app_access_token: token } = await (await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })).json();
    if (!token) throw new Error('token 为空');
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([buf], { type: 'image/png' }), 'qr.png');
    const { data: { image_key } } = await (await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    })).json();
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card: {
        header: { title: { tag: 'plain_text', content: '🔑 小红书扫码绑定请求' }, template: 'red' },
        elements: [
          { tag: 'img', img_key: image_key, alt: { tag: 'plain_text', content: '二维码' } },
          { tag: 'div', text: { tag: 'plain_text', content: '请在 3 分钟内扫码登录小红书创作者中心' } },
        ],
      }}) });
    console.log('[飞书] ✅ QR 卡片已发送');
  } catch (e) { console.warn('[飞书] 失败:', e.message); }
}

async function sendFeishuText(text) {
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!webhook) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text } });
  return new Promise((r) => {
    try {
      const u = new URL(webhook);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => { res.resume(); r(); });
      req.on('error', () => r()); req.write(payload); req.end();
    } catch { r(); }
  });
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log('[info] 导航...');
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 截图 + dump 可点击元素
    await page.screenshot({ path: 'xiaohongshu-stage1.png' });
    const clickables = await page.evaluate(() => {
      const els = document.querySelectorAll('a, button, [role="button"], [class*="tab"], [class*="switch"], [class*="qr"], [class*="scan"], [class*="code"], [class*="login"]');
      return Array.from(els).slice(0, 30).map(el => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString()?.slice(0, 80),
        txt: el.textContent?.trim()?.slice(0, 40),
        href: el.href || '',
      }));
    });
    console.log('[DOM] 登录区可点击元素:');
    clickables.forEach(e => console.log(`  ${e.tag} | "${e.txt}" | cls=${e.cls}`));

    // 尝试点击 QR 入口（文本 + class 双路）
    const QR_TEXT = ['扫码登录', '二维码登录', '扫码', '扫一扫', 'QR', '扫码登录'];
    const QR_CLASS = ['qrcode', 'qr-login', 'qr_login', 'scan-login', 'code-login', 'login-qr', 'switch-qr'];
    let clicked = false;

    for (const txt of QR_TEXT) {
      try {
        const el = await page.locator(`text="${txt}"`).first();
        if (await el.count() > 0) {
          await el.click({ timeout: 2000 });
          console.log(`[info] 点击文本: "${txt}"`);
          clicked = true; await page.waitForTimeout(1500); break;
        }
      } catch { /* */ }
    }

    if (!clicked) {
      for (const cls of QR_CLASS) {
        try {
          const el = await page.$(`[class*="${cls}"]`);
          if (el) { await el.click(); console.log(`[info] 点击 class: *${cls}*`); clicked = true; await page.waitForTimeout(1500); break; }
        } catch { /* */ }
      }
    }

    if (!clicked) {
      // 尝试点击登录框右上角区域（QR 图标通常在此）
      try {
        const formBox = await page.$('.login-container, [class*="login-box"], [class*="login-wrap"], form');
        if (formBox) {
          const bb = await formBox.boundingBox();
          if (bb) {
            // 右上角偏移
            await page.mouse.click(bb.x + bb.width - 20, bb.y + 20);
            console.log(`[info] 坐标点击登录框右上角 (${Math.round(bb.x+bb.width-20)}, ${Math.round(bb.y+20)})`);
            clicked = true; await page.waitForTimeout(1500);
          }
        }
      } catch { /* */ }
    }

    await page.screenshot({ path: 'xiaohongshu-stage2.png' });
    console.log('[info] stage2 截图已保存');

    // 找 QR 元素
    const QR_SELS = [
      '[class*="qrcode"] canvas', '[class*="qr-code"] canvas', '[class*="qrCode"] canvas',
      '[class*="scanCode"] canvas', '[class*="scan"] canvas',
      '[class*="qrcode"] img', '[class*="qr-code"] img', '[class*="qrCode"] img',
      'img[src*="qrcode"]', 'img[src*="qr_"]', 'img[src*="/qr"]',
      '[class*="login"] canvas', 'canvas',
    ];

    let qrEl = null;
    const deadline = Date.now() + 30000;
    outer: while (Date.now() < deadline) {
      for (const sel of QR_SELS) {
        try {
          const els = await page.$$(sel);
          for (const el of els) {
            const box = await el.boundingBox().catch(() => null);
            if (box && box.width >= 80 && box.width <= 400 && box.height >= 80 && box.height <= 400) {
              const tag = await el.evaluate(e => e.tagName.toLowerCase());
              const loaded = tag !== 'img' || await el.evaluate(e => e.complete && e.naturalWidth > 0);
              if (loaded) { console.log(`[info] QR 匹配 "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`); qrEl = el; break outer; }
            }
          }
        } catch { /* */ }
      }
      await page.waitForTimeout(500);
    }

    if (qrEl) {
      const buf = await qrEl.screenshot({ type: 'png' });
      fs.writeFileSync('xiaohongshu-qr.png', buf);
      await sendFeishuQrCard(buf);
    } else {
      await page.screenshot({ path: 'xiaohongshu-qr.png', fullPage: false });
      console.log('[warn] 未找到 QR 元素，全页截图');
      await sendFeishuText('⚠️ 小红书 QR 绑定：未识别到 QR 元素，请查看 artifact "xiaohongshu-stage2.png" 确认页面状态，然后告知 Claude 调整选择器');
    }

    // 轮询
    console.log('[info] 开始等扫码...');
    const start = Date.now();
    let success = false;
    while (Date.now() - start < TIMEOUT_MS) {
      const st = await context.storageState().catch(() => null);
      if (st) {
        const cookies = st.cookies || [];
        if (cookies.some(c => SESSION_COOKIES.includes(c.name) && c.value)) { success = true; break; }
        const n = Math.floor((Date.now()-start)/POLL_MS);
        if (n % 20 === 1) {
          const f = cookies.filter(c => SESSION_COOKIES.includes(c.name)).map(c => c.name);
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | ${cookies.length}个cookie | found:[${f.join(',')}]`);
        }
      }
      await page.waitForTimeout(POLL_MS);
    }

    if (!success) {
      await page.screenshot({ path: 'xiaohongshu-bind-timeout.png' }).catch(() => {});
      await sendFeishuText('🔴 小红书 Session 绑定超时');
      console.error('[FAIL] 超时');
      process.exit(1);
    }

    const storageState = await context.storageState();
    const found = (storageState.cookies || []).filter(c => SESSION_COOKIES.includes(c.name)).map(c => c.name);
    console.log(`[info] ✅ 登录成功: [${found.join(', ')}]`);
    fs.writeFileSync('xiaohongshu-session.json', JSON.stringify(storageState, null, 2));
    await page.screenshot({ path: 'xiaohongshu-bind-success.png' }).catch(() => {});
    await sendFeishuText(`✅ 小红书 Session 绑定成功！[${found.join(', ')}]`);
    console.log('PASS');

  } finally {
    await browser?.close().catch(() => {});
  }
}

main().catch(async e => {
  console.error('[FAIL]', e.message);
  await sendFeishuText('🔴 小红书异常: ' + e.message.slice(0, 200)).catch(() => {});
  process.exit(1);
});
