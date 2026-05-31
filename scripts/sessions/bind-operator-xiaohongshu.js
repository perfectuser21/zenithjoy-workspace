#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v6
 * - 用 elementFromPoint 精确探查 form 各区域
 * - 明确点 slot-right + css-1p87pnn 两个候选
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
  const appId = process.env.FEISHU_APP_ID || '', appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) { console.log('[飞书] 未配置'); return; }
  try {
    const { app_access_token: token } = await (await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }) })).json();
    const form = new FormData();
    form.append('image_type', 'message'); form.append('image', new Blob([buf], { type: 'image/png' }), 'qr.png');
    const { data: { image_key } } = await (await fetch('https://open.feishu.cn/open-apis/im/v1/images',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })).json();
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
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
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
        if (!box || box.width < 80 || box.width > 400 || box.height < 80) continue;
        const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
        const ok = tag !== 'img' || await el.evaluate(e => e.complete && e.naturalWidth > 0).catch(() => true);
        if (ok) { console.log(`[QR] 匹配 "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`); return el; }
      }
    } catch { /**/ }
  }
  return null;
}

async function tryClickAndCheckQr(page, cx, cy, label, stageFile) {
  console.log(`[click] ${label} (${Math.round(cx)},${Math.round(cy)})`);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: stageFile });
  return await findQrElement(page);
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
    await page.waitForTimeout(5000); // 等 JS 完全加载
    await page.screenshot({ path: 'stage1-initial.png' });

    // 用 elementFromPoint 探查 form 附近区域
    const probePoints = await page.evaluate(() => {
      const points = [];
      // 探查范围：x=1050-1200, y=270-480，步长 15
      for (let y = 270; y <= 480; y += 15) {
        for (let x = 1050; x <= 1200; x += 20) {
          const el = document.elementFromPoint(x, y);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const info = { x, y, tag: el.tagName.toLowerCase(),
            cls: el.className?.toString()?.slice(0,60) || '',
            txt: el.textContent?.trim()?.slice(0,30) || '',
            w: Math.round(r.width), h: Math.round(r.height),
            cursor: window.getComputedStyle(el).cursor };
          // 只保留非 body/html 的 pointer 元素，或特殊 class
          if (info.cursor === 'pointer' || info.cls.includes('slot') || info.cls.includes('qr') || info.cls.includes('scan')) {
            points.push(info);
          }
        }
      }
      // 去重（同 class+tag 组合）
      const seen = new Set();
      return points.filter(p => { const k = `${p.tag}|${p.cls}`; if (seen.has(k)) return false; seen.add(k); return true; });
    });

    console.log(`[probe] cursor:pointer 或特殊 class 元素 (${probePoints.length} 个):`);
    probePoints.forEach(p => console.log(`  ${p.tag} (${p.x},${p.y}) ${p.w}x${p.h} cursor=${p.cursor} cls=${p.cls} txt="${p.txt}"`));

    // 依次点击所有 cursor:pointer 元素，检查 QR 是否出现
    let qrEl = null;
    let stageN = 2;
    for (const p of probePoints) {
      if (qrEl) break;
      qrEl = await tryClickAndCheckQr(page, p.x + 5, p.y + 5, `${p.tag} cls=${p.cls}`, `stage${stageN}-click.png`);
      stageN++;
      if (qrEl) { console.log('[info] ✅ QR 出现！'); break; }
    }

    // 兜底：点击 slot-right 和 css-1p87pnn 两个已知候选
    if (!qrEl) {
      for (const sel of ['.slot-right', '[class*="slot-right"]', '[class*="css-1p87pnn"]', '[class*="css-1g4jyns"]']) {
        try {
          const el = await page.$(sel);
          if (el) {
            const bb = await el.boundingBox().catch(() => null);
            if (bb) {
              qrEl = await tryClickAndCheckQr(page, bb.x + bb.width/2, bb.y + bb.height/2, sel, `stage${stageN}-selector.png`);
              stageN++;
              if (qrEl) break;
            }
          }
        } catch { /**/ }
      }
    }

    // 兜底：navigate to /login
    if (!qrEl) {
      console.log('[info] 尝试 /login 直接导航...');
      await page.goto('https://creator.xiaohongshu.com/login', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(5000);
      await page.screenshot({ path: `stage${stageN}-login.png` });
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
      await sendFeishuText('⚠️ 小红书 QR 绑定：无法自动找到 QR 元素，请查看 artifact 中的 stage 截图（特别是 stage*-click.png）判断哪步需要调整');
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
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | ${cookies.length}cookie | found:[${f.join(',')}]`);
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
