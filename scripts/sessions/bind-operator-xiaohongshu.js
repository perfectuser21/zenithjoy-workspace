#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v5
 * - 全量扫描 form 右上角小元素，依次点击直到出现 QR
 * - 上传所有 stage 截图供调试
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
    const { app_access_token: token } = await (await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }) }
    )).json();
    if (!token) throw new Error('token empty');
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([buf], { type: 'image/png' }), 'qr.png');
    const { data: { image_key } } = await (await fetch(
      'https://open.feishu.cn/open-apis/im/v1/images',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
    )).json();
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card: {
        header: { title: { tag: 'plain_text', content: '🔑 小红书扫码绑定' }, template: 'red' },
        elements: [
          { tag: 'img', img_key: image_key, alt: { tag: 'plain_text', content: 'QR' } },
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
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      res => { res.resume(); r(); });
    req.on('error', () => r()); req.write(payload); req.end();
  });
}

async function findQrElement(page) {
  const QR_SELS = [
    '[class*="qrcode"] canvas', '[class*="qr-code"] canvas', '[class*="qrCode"] canvas',
    '[class*="scanCode"] canvas', '[class*="scan"] canvas', 'canvas[class*="qr"]',
    '[class*="qrcode"] img', '[class*="qr-code"] img', '[class*="qrCode"] img',
    'img[src*="qrcode"]', 'img[src*="qr_"]', 'img[src*="/qr"]',
    '[class*="login"] canvas', 'canvas',
  ];
  for (const sel of QR_SELS) {
    try {
      for (const el of await page.$$(sel)) {
        const box = await el.boundingBox().catch(() => null);
        if (!box || box.width < 80 || box.width > 400 || box.height < 80 || box.height > 400) continue;
        const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
        const ok = tag !== 'img' || await el.evaluate(e => e.complete && e.naturalWidth > 0).catch(() => true);
        if (ok) { console.log(`[QR] 匹配 "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`); return el; }
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
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    console.log('[info] 导航...');
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'stage1-initial.png' });

    // 全量扫描：找 form 区域内的所有小元素（< 60x60），依次点击
    const smallEls = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const results = [];
      for (const el of all) {
        const r = el.getBoundingClientRect();
        // 小图标：宽高均在 10-60px
        if (r.width < 10 || r.width > 60 || r.height < 10 || r.height > 60) continue;
        // 在页面右半部分（登录框区域）
        if (r.x < 700) continue;
        // 在页面上半部分
        if (r.y > 600) continue;
        results.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString()?.slice(0, 80) || '',
          txt: el.textContent?.trim()?.slice(0, 30) || '',
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height),
        });
      }
      return results.slice(0, 30);
    });

    console.log(`[DOM] 右侧小元素 (${smallEls.length} 个):`);
    smallEls.forEach(e => console.log(`  ${e.tag} | (${e.x},${e.y}) ${e.w}x${e.h} | "${e.txt}" | cls=${e.cls}`));

    // 按 y 坐标排序，优先点击靠上的（QR 图标通常在 form 顶部）
    const topEls = smallEls.filter(e => e.y < 350).sort((a, b) => a.y - b.y);
    let qrEl = null;
    let stageN = 2;

    for (const el of topEls) {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      console.log(`[click] (${cx},${cy}) ${el.tag} "${el.txt}" cls=${el.cls}`);
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `stage${stageN}-after-click.png` });
      stageN++;

      qrEl = await findQrElement(page);
      if (qrEl) { console.log('[info] QR 出现！'); break; }
    }

    if (!qrEl) {
      // 兜底：尝试直接导航登录页
      console.log('[info] 尝试直接导航 /login ...');
      await page.goto('https://creator.xiaohongshu.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `stage${stageN}-login-page.png` });
      stageN++;
      qrEl = await findQrElement(page);
    }

    let qrBuf = null;
    if (qrEl) {
      qrBuf = await qrEl.screenshot({ type: 'png' });
      fs.writeFileSync('xiaohongshu-qr.png', qrBuf);
      await sendFeishuQrCard(qrBuf);
    } else {
      await page.screenshot({ path: 'xiaohongshu-qr.png' });
      console.log('[warn] 未找到 QR，全页截图');
      await sendFeishuText('⚠️ 小红书 QR：仍未找到 QR 元素，请查看 stage 截图');
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
      await sendFeishuText('🔴 小红书 Session 绑定超时');
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
