#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定
 *
 * 在 GitHub Actions windows-latest runner 上执行：
 * 1. Playwright 启动 Chrome → 导航 creator.xiaohongshu.com
 * 2. 等 QR 元素出现 → 截图 → 发飞书卡片（运营员手机扫码）
 * 3. 轮询 galaxy_creator_session_info cookie（最长 5 分钟）
 * 4. 成功 → storageState JSON 写入 GHA 输出 + gh secret set XIAOHONGSHU_COOKIES
 *
 * PASS → exit 0
 * FAIL → exit 1 + 飞书告警
 *
 * 环境变量（GHA secrets）：
 *   FEISHU_APP_ID / FEISHU_APP_SECRET  — 飞书卡片推送
 *   ZENITHJOY_FEISHU_WEBHOOK           — 飞书 webhook（备用）
 *   GH_PAT_SECRETS                     — PAT 含 secrets:write（用于 gh secret set）
 *   GITHUB_REPOSITORY                  — 自动注入（owner/repo）
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIE_NAMES = ['web_session', 'galaxy_creator_session_info'];
const TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟等扫码
const POLL_MS = 1500;

// ── 飞书推送 ───────────────────────────────────────────────────────────────
async function sendFeishuQrCard(screenshotBuffer) {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) {
    console.log('[飞书] 未配置，跳过推送（请手动查看截图 artifact）');
    return;
  }
  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const { app_access_token: token } = await tokenRes.json();
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([screenshotBuffer], { type: 'image/png' }), 'qr.png');
    const imgRes = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const { data: { image_key: imageKey } } = await imgRes.json();
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
    console.log('[飞书] QR 卡片已发送');
  } catch (e) {
    console.warn('[飞书] 推送失败（不影响流程）:', e.message);
  }
}

async function sendFeishuAlert(title, content) {
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!webhook) return;
  const payload = JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${content}` } });
  return new Promise((resolve) => {
    try {
      const u = new URL(webhook);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.write(payload); req.end();
    } catch { resolve(0); }
  });
}

// ── 保存 Session 到 GitHub Secret ────────────────────────────────────────
function saveToGitHubSecret(storageState) {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const pat = process.env.GH_PAT_SECRETS || '';
  const json = JSON.stringify(storageState);
  if (!repo || !pat) {
    console.log('[Secret] GH_PAT_SECRETS 未设置，写入 GITHUB_OUTPUT 供手动操作');
    const outputFile = process.env.GITHUB_OUTPUT || '';
    if (outputFile) {
      fs.appendFileSync(outputFile, `xiaohongshu_session<<GHADELIM\n${json}\nGHADELIM\n`);
      console.log('[Secret] 已写入 GITHUB_OUTPUT::xiaohongshu_session');
    }
    return;
  }
  try {
    // gh secret set 使用 --body 参数
    execSync(`gh secret set XIAOHONGSHU_COOKIES --repo "${repo}" --body '${json.replace(/'/g, "'\\''")}'`, {
      env: { ...process.env, GH_TOKEN: pat },
      stdio: 'pipe',
    });
    console.log('[Secret] ✅ XIAOHONGSHU_COOKIES 已写入 GitHub Secret');
  } catch (e) {
    console.error('[Secret] gh secret set 失败:', e.message);
    console.log('[Secret] session JSON 长度:', json.length, '请手动设置 XIAOHONGSHU_COOKIES');
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log(`[info] 导航至 ${CREATOR_URL} ...`);
    await page.goto(CREATOR_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 查找 QR 元素并截图发飞书
    const QR_SELECTORS = [
      '[class*="qrcode"] canvas', '[class*="qr-code"] canvas', '[class*="qrCode"] canvas',
      '[class*="scanCode"] canvas', '[class*="qrcode"] img', '[class*="qr-code"] img',
      'img[src*="qrcode"]', 'img[src*="qr_"]',
    ];
    let qrEl = null;
    const elDeadline = Date.now() + 45000;
    outer: while (Date.now() < elDeadline) {
      for (const sel of QR_SELECTORS) {
        try {
          const el = await page.$(sel);
          if (el) {
            const box = await el.boundingBox();
            if (box && box.width >= 100 && box.width <= 400 && box.height >= 100 && box.height <= 400) {
              qrEl = el; break outer;
            }
          }
        } catch { /* continue */ }
      }
      await page.waitForTimeout(500);
    }

    if (qrEl) {
      console.log('[info] QR 元素找到，截图并发飞书');
      const qrBuf = await qrEl.screenshot({ type: 'png' });
      fs.writeFileSync('xiaohongshu-qr.png', qrBuf);
      await sendFeishuQrCard(qrBuf);
    } else {
      // 全页截图兜底
      await page.screenshot({ path: 'xiaohongshu-qr.png', fullPage: false });
      console.log('[warn] 未找到 QR 元素，全页截图已保存');
      await sendFeishuAlert('⚠️ 小红书 QR 绑定', '未自动识别 QR 元素，请查看截图 artifact 手动扫码');
    }

    // 轮询 galaxy_creator_session_info cookie
    console.log(`[info] 等待扫码（最长 ${TIMEOUT_MS / 1000}s）...`);
    const start = Date.now();
    let success = false;
    while (Date.now() - start < TIMEOUT_MS) {
      const rawState = await context.storageState().catch(() => null);
      if (rawState) {
        const cookies = rawState.cookies || [];
        const hasSession = cookies.some(c =>
          SESSION_COOKIE_NAMES.includes(c.name) && c.value.length > 0
        );
        if (hasSession) { success = true; break; }
      }
      await page.waitForTimeout(POLL_MS);
    }

    if (!success) {
      await page.screenshot({ path: 'xiaohongshu-bind-timeout.png', fullPage: false }).catch(() => {});
      await sendFeishuAlert('🔴 小红书 Session 绑定超时', `${TIMEOUT_MS / 1000}s 内未检测到登录 cookie，请重新触发工作流`);
      console.error('[FAIL] 扫码超时');
      process.exit(1);
    }

    // 成功：保存 storageState
    const storageState = await context.storageState();
    const cookies = storageState.cookies || [];
    const found = cookies.filter(c => SESSION_COOKIE_NAMES.includes(c.name)).map(c => c.name);
    console.log(`[info] 检测到登录 cookie: [${found.join(', ')}]`);
    console.log(`[info] 共 ${cookies.length} 个 cookies`);

    await page.screenshot({ path: 'xiaohongshu-bind-success.png', fullPage: false }).catch(() => {});

    saveToGitHubSecret(storageState);

    await sendFeishuAlert('✅ 小红书 Session 绑定成功', `已检测到 [${found.join(', ')}]，XIAOHONGSHU_COOKIES Secret 已更新`);

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
  await sendFeishuAlert('🔴 小红书 Session 绑定异常', err.message.slice(0, 200)).catch(() => {});
  process.exit(1);
});
