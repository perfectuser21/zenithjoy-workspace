#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定
 *
 * 1. 打开 creator.xiaohongshu.com → 点击 QR 登录入口
 * 2. 截图 QR → 发飞书卡片（运营员扫码）
 * 3. 轮询 galaxy_creator_session_info cookie（最长 5 分钟）
 * 4. 成功 → 写 xiaohongshu-session.json（由后续步骤上传 artifact，Claude 本地 gh secret set）
 */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIE_NAMES = ['web_session', 'galaxy_creator_session_info'];
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 1500;

async function sendFeishuQrCard(screenshotBuffer) {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) {
    console.log('[飞书] 未配置，仅保存截图 artifact');
    return;
  }
  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const { app_access_token: token } = await tokenRes.json();
    if (!token) throw new Error('飞书 token 获取失败');

    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([screenshotBuffer], { type: 'image/png' }), 'qr.png');
    const imgRes = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const imgJson = await imgRes.json();
    const imageKey = imgJson.data?.image_key;
    if (!imageKey) throw new Error('飞书图片上传失败: ' + JSON.stringify(imgJson));

    const card = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: '🔑 小红书扫码绑定请求' }, template: 'red' },
        elements: [
          { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '二维码' } },
          { tag: 'div', text: { tag: 'plain_text', content: '请在 3 分钟内用手机扫描上方二维码登录小红书创作者中心' } },
        ],
      },
    };
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(card) });
    console.log('[飞书] ✅ QR 卡片已发送');
  } catch (e) {
    console.warn('[飞书] 推送失败（不影响流程）:', e.message);
  }
}

async function sendFeishuText(text) {
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!webhook) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text } });
  return new Promise((resolve) => {
    try {
      const u = new URL(webhook);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => { res.resume(); resolve(); });
      req.on('error', () => resolve());
      req.write(payload); req.end();
    } catch { resolve(); }
  });
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log(`[info] 导航至 ${CREATOR_URL}`);
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 点击 QR 登录入口（常见选择器）
    const QR_TAB_SELECTORS = [
      '[class*="qrcode"]',
      '[class*="qr-login"]',
      '[class*="scan"]',
      'text=扫码登录',
      'text=二维码登录',
      'text=扫码',
      '[data-logintype="qrcode"]',
      'a:has-text("扫码")',
      'button:has-text("扫码")',
      'span:has-text("扫码登录")',
    ];

    let clickedQrTab = false;
    for (const sel of QR_TAB_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click().catch(() => {});
          console.log(`[info] 已点击 QR 入口: ${sel}`);
          clickedQrTab = true;
          await page.waitForTimeout(2000);
          break;
        }
      } catch { /* continue */ }
    }
    if (!clickedQrTab) console.log('[warn] 未找到 QR 入口按钮，继续尝试截图');

    // 等 QR 元素出现
    const QR_SELECTORS = [
      '[class*="qrcode"] canvas',
      '[class*="qr-code"] canvas',
      '[class*="qrCode"] canvas',
      '[class*="scanCode"] canvas',
      '[class*="scan-code"] canvas',
      'canvas[class*="qr"]',
      '[class*="qrcode"] img',
      '[class*="qr-code"] img',
      '[class*="qrCode"] img',
      'img[src*="qrcode"]',
      'img[src*="qr_"]',
      '[class*="login"] canvas',
      'canvas',
    ];

    const isQrSize = (box) => box.width >= 80 && box.width <= 400 && box.height >= 80 && box.height <= 400;
    const isImgLoaded = async (el) => {
      try {
        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        return tag !== 'img' || await el.evaluate(e => e.complete && e.naturalWidth > 0);
      } catch { return false; }
    };

    let qrEl = null;
    const elDeadline = Date.now() + 45000;
    outer: while (Date.now() < elDeadline) {
      for (const sel of QR_SELECTORS) {
        try {
          const els = await page.$$(sel);
          for (const el of els) {
            const box = await el.boundingBox().catch(() => null);
            if (box && isQrSize(box) && await isImgLoaded(el)) {
              console.log(`[info] QR 匹配: "${sel}" ${Math.round(box.width)}×${Math.round(box.height)}`);
              qrEl = el; break outer;
            }
          }
        } catch { /* continue */ }
      }
      await page.waitForTimeout(500);
    }

    if (qrEl) {
      const qrBuf = await qrEl.screenshot({ type: 'png' });
      fs.writeFileSync('xiaohongshu-qr.png', qrBuf);
      console.log('[info] QR 截图已保存，发飞书...');
      await sendFeishuQrCard(qrBuf);
    } else {
      // 全页截图兜底
      await page.screenshot({ path: 'xiaohongshu-qr.png', fullPage: false });
      console.log('[warn] 未找到 QR 元素，全页截图已保存，通过飞书提示');
      await sendFeishuText('⚠️ 小红书 QR 绑定：未自动识别 QR 元素，请查看 GitHub Actions artifact "xiaohongshu-qr.png" 手动扫码（页面已打开等待扫码）');
    }

    // 轮询 cookie
    console.log(`[info] 等待扫码（最长 ${TIMEOUT_MS / 1000}s）...`);
    const start = Date.now();
    let success = false;
    while (Date.now() - start < TIMEOUT_MS) {
      const rawState = await context.storageState().catch(() => null);
      if (rawState) {
        const cookies = rawState.cookies || [];
        if (cookies.some(c => SESSION_COOKIE_NAMES.includes(c.name) && c.value.length > 0)) {
          success = true; break;
        }
        // 每 20 次打印诊断
        const pollN = Math.floor((Date.now() - start) / POLL_MS);
        if (pollN % 20 === 1) {
          const found = cookies.filter(c => SESSION_COOKIE_NAMES.includes(c.name)).map(c => c.name);
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | 共${cookies.length}个cookie | 目标found:[${found.join(',')}]`);
        }
      }
      await page.waitForTimeout(POLL_MS);
    }

    if (!success) {
      await page.screenshot({ path: 'xiaohongshu-bind-timeout.png' }).catch(() => {});
      await sendFeishuText('🔴 小红书 Session 绑定超时（5 分钟内未扫码），请重新触发工作流');
      console.error('[FAIL] 扫码超时');
      process.exit(1);
    }

    const storageState = await context.storageState();
    const cookies = storageState.cookies || [];
    const found = cookies.filter(c => SESSION_COOKIE_NAMES.includes(c.name)).map(c => c.name);
    console.log(`[info] ✅ 登录成功 cookies: [${found.join(', ')}]，共 ${cookies.length} 个`);

    // 写 session 文件（由 artifact upload 步骤保存，Claude 本地 gh secret set）
    fs.writeFileSync('xiaohongshu-session.json', JSON.stringify(storageState, null, 2));
    console.log('[info] session 已写入 xiaohongshu-session.json');

    await page.screenshot({ path: 'xiaohongshu-bind-success.png' }).catch(() => {});
    await sendFeishuText(`✅ 小红书 Session 绑定成功！检测到 [${found.join(', ')}]，共 ${cookies.length} 个 cookie`);

    console.log('');
    console.log('============================================');
    console.log('  PASS: 小红书运营员 session 绑定成功');
    console.log(`  Cookies: [${found.join(', ')}]`);
    console.log('============================================');

  } finally {
    await browser?.close().catch(() => {});
  }
}

main().catch(async (err) => {
  console.error('[FAIL] 未预期异常:', err.message);
  await sendFeishuText('🔴 小红书 Session 绑定异常: ' + err.message.slice(0, 200)).catch(() => {});
  process.exit(1);
});
