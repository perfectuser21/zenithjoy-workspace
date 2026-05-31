#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v4
 * - 精确点击 sso-login-wrapper 右上角小图标（QR 切换）
 */

import { createRequire } from 'module';
import fs from 'fs';
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
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([buf], { type: 'image/png' }), 'qr.png');
    const { data: { image_key } } = await (await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    })).json();
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card: {
        header: { title: { tag: 'plain_text', content: '🔑 小红书扫码绑定' }, template: 'red' },
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
  return new Promise(r => {
    const u = new URL(webhook);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => { res.resume(); r(); });
    req.on('error', () => r()); req.write(payload); req.end();
  });
}

async function findAndScreenshotQr(page, label) {
  const QR_SELS = [
    '[class*="qrcode"] canvas', '[class*="qr-code"] canvas', '[class*="qrCode"] canvas',
    '[class*="scanCode"] canvas', '[class*="scan"] canvas',
    '[class*="qrcode"] img', '[class*="qr-code"] img', '[class*="qrCode"] img',
    'img[src*="qrcode"]', 'img[src*="qr_"]', 'img[src*="/qr"]',
    '[class*="login"] canvas', 'canvas',
  ];
  for (const sel of QR_SELS) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        const box = await el.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.width < 80 || box.width > 400 || box.height < 80 || box.height > 400) continue;
        const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
        const loaded = tag !== 'img' || await el.evaluate(e => e.complete && e.naturalWidth > 0).catch(() => true);
        if (loaded) {
          console.log(`[info] ${label} QR "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`);
          return await el.screenshot({ type: 'png' });
        }
      }
    } catch { /**/ }
  }
  return null;
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    console.log('[info] 导航...');
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'xiaohongshu-stage1.png' });

    // 找 sso-login-wrapper，点右上角 QR 图标
    const loginSelectors = [
      '.sso-login-wrapper',
      '[class*="sso-login"]',
      '[class*="login-box"]',
      '[class*="login-container"]',
      'form',
    ];

    let clicked = false;
    for (const sel of loginSelectors) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        const bb = await el.boundingBox();
        if (!bb) continue;
        // 右上角：距右边 20px，距顶 20px
        const cx = bb.x + bb.width - 20;
        const cy = bb.y + 20;
        console.log(`[info] 找到 "${sel}" bb=(${Math.round(bb.x)},${Math.round(bb.y)},${Math.round(bb.width)}x${Math.round(bb.height)}) 点击 (${Math.round(cx)},${Math.round(cy)})`);

        // 截图并标记点击位置
        await page.screenshot({ path: 'xiaohongshu-before-click.png' });
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'xiaohongshu-after-click.png' });
        clicked = true;
        break;
      } catch (e) { console.log(`[warn] ${sel}: ${e.message}`); }
    }

    // 如果上面没点到，尝试 evaluate 找 QR 图标元素
    if (!clicked) {
      console.log('[info] 尝试 evaluate 找 QR 图标...');
      const qrIconInfo = await page.evaluate(() => {
        // 小红书登录框右上角通常有 img 或 svg 作为 QR 切换
        const allEls = document.querySelectorAll('[class*="login"] img, [class*="login"] svg, [class*="sso"] img, [class*="sso"] svg');
        return Array.from(allEls).slice(0, 10).map(el => {
          const r = el.getBoundingClientRect();
          return { tag: el.tagName, cls: el.className?.toString()?.slice(0,60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
      });
      console.log('[DOM] login 区域图片/图标:', JSON.stringify(qrIconInfo));

      // 点击第一个疑似 QR 图标（宽高 20-60px）
      for (const info of qrIconInfo) {
        if (info.w >= 20 && info.w <= 60 && info.h >= 20 && info.h <= 60) {
          await page.mouse.click(info.x + info.w/2, info.y + info.h/2);
          console.log(`[info] 点击图标 (${info.x},${info.y}) ${info.w}x${info.h} cls=${info.cls}`);
          await page.waitForTimeout(2000);
          clicked = true;
          break;
        }
      }
    }

    await page.screenshot({ path: 'xiaohongshu-stage2.png' });

    // 尝试找 QR
    let qrBuf = await findAndScreenshotQr(page, 'stage2');

    if (!qrBuf) {
      // 再等 10s 看是否懒加载
      await page.waitForTimeout(10000);
      qrBuf = await findAndScreenshotQr(page, 'stage3');
      await page.screenshot({ path: 'xiaohongshu-stage3.png' });
    }

    if (qrBuf) {
      fs.writeFileSync('xiaohongshu-qr.png', qrBuf);
      await sendFeishuQrCard(qrBuf);
    } else {
      await page.screenshot({ path: 'xiaohongshu-qr.png', fullPage: false });
      console.log('[warn] 未找到 QR，全页截图 + 飞书文字通知');
      await sendFeishuText('⚠️ 小红书 QR 绑定：QR 元素未识别。请查看 artifact 截图（stage1/2/3）确认页面状态');
    }

    // 轮询 cookie
    console.log('[info] 等待扫码...');
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
      await sendFeishuText('🔴 小红书 Session 绑定超时（5 分钟）');
      console.error('[FAIL] 超时'); process.exit(1);
    }

    const storageState = await context.storageState();
    const found = (storageState.cookies||[]).filter(c => SESSION_COOKIES.includes(c.name)).map(c => c.name);
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
