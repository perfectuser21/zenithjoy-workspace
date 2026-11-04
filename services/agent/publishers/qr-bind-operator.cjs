#!/usr/bin/env node
'use strict';
/**
 * qr-bind-operator.cjs — 运营员 Session 绑定（外部进程）
 *
 * pkg 二进制内 require('playwright') 在 Node 18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node.js 进程运行，从真实文件系统加载 playwright-core，绕过 pkg VFS 限制。
 *
 * Usage: node qr-bind-operator.cjs <platform> <api_base> <account_label> [timeout_ms]
 * Output: 最后一行 stdout JSON → { ok, platform, sessionPath, error? }
 * Logs:   stderr（不干扰 JSON 解析）
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { sendFeishuQrCard } = require('./qr-notification.cjs');

const [,, platform, apiBase = '', accountLabel = 'default', timeoutMsStr = '300000'] = process.argv;
const timeoutMs = parseInt(timeoutMsStr, 10) || 300000;
const CDP_PORT = parseInt(process.env.ZENITHJOY_CHROME_DEBUG_PORT || '19222', 10);

const PLATFORM_SESSION_COOKIES = {
  douyin:       ['sessionid_ss', 'sessionid', 'sid_tt'],
  toutiao:      ['sessionid', 'sid_tt'],
  kuaishou:     ['userId', 'kuaishou.sid', 'passToken'],
  xiaohongshu:  ['web_session', 'galaxy_creator_session_info'],
  weibo:        ['SUB', 'SUBP'],
  zhihu:        ['z_c0', 'SESSIONID'],
  shipinhao:    ['skey', 'uin'],
  gongzhonghao: ['skey', 'uin'],
};

const PLATFORM_CREATOR_URLS = {
  douyin:       'https://creator.douyin.com/creator-micro/home',
  kuaishou:     'https://cp.kuaishou.com/article/publish/video',
  xiaohongshu:  'https://creator.xiaohongshu.com/publish/publish',
  shipinhao:    'https://channels.weixin.qq.com/platform/login',
  toutiao:      'https://mp.toutiao.com/profile_v4/graphic/publish',
  weibo:        'https://weibo.com/login.php',
  zhihu:        'https://www.zhihu.com/creator',
  gongzhonghao: 'https://mp.weixin.qq.com',
};

function isSessionReady(storageState, plat) {
  const names = PLATFORM_SESSION_COOKIES[plat] || [];
  const cookies = (storageState && storageState.cookies) || [];
  return cookies.some(
    c => typeof c.value === 'string' && c.value.length > 0 && names.includes(c.name),
  );
}

function getSessionPath(plat, label) {
  const dir = path.join(os.homedir(), '.zenithjoy-agent', 'sessions', 'operator', plat);
  return path.join(dir, `${label}.json`);
}

function emit(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function main() {
  if (!platform || !PLATFORM_CREATOR_URLS[platform]) {
    emit({ ok: false, platform, error: `不支持的平台: ${platform}` });
    process.exit(1);
    return;
  }

  const sessionPath = getSessionPath(platform, accountLabel);
  let browser = null;
  let usingCdp = false;

  try {
    // CDP 优先：接管已有 Chrome（xian-pc 常驻 --remote-debugging-port=19222）
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`, { timeout: 3000 });
      usingCdp = true;
      process.stderr.write(`[qr-bind-operator:${platform}] CDP 连接成功 (port ${CDP_PORT})\n`);
    } catch {
      // CDP 失败 → 依次尝试：bundled chromium → system Chrome → system Edge
      // playwright-browsers 可能只含 headless shell（不支持 headless:false），所以要多级 fallback
      let launched = false;
      const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
      for (const opts of [
        { headless: false, args: launchArgs },                             // bundled Chromium
        { headless: false, channel: 'chrome', args: launchArgs },          // system Google Chrome
        { headless: false, channel: 'msedge', args: launchArgs },          // system Microsoft Edge
      ]) {
        try {
          browser = await chromium.launch(opts);
          launched = true;
          process.stderr.write(`[qr-bind-operator:${platform}] 已 launch (${JSON.stringify(opts)})\n`);
          break;
        } catch { /* 继续下一个 */ }
      }
      if (!launched) {
        throw new Error('无法启动浏览器：bundled chromium / system chrome / system edge 均不可用');
      }
    }

    // CDP 模式复用已有 context（避免开隐身窗口）；launch 模式新建 context
    const ctx = usingCdp ? browser.contexts()[0] : await browser.newContext();
    if (!ctx) {
      emit({ ok: false, platform, error: 'Chrome 启动后无法获取 context' });
      process.exit(1);
      return;
    }

    const creatorUrl = PLATFORM_CREATOR_URLS[platform];
    // CDP 模式在已有 context 开新标签页；launch 模式用第一个页面或新建
    const page = ctx.newPage ? await ctx.newPage() : (ctx.pages ? ctx.pages()[0] : null);
    if (page && page.goto) {
      await page.goto(creatorUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }

    // 等 QR 元素出现后截图发飞书（不依赖 URL，找到才发，找不到静默跳过）
    if (page) {
      try {
        // 具体 QR 语义选择器优先；通用 canvas 放最后（避免匹配背景大 canvas）
        const QR_SELECTORS = [
          '[class*="qrcode"] canvas',
          '[class*="qr-code"] canvas',
          '[class*="qrCode"] canvas',
          '[class*="scanCode"] canvas',
          '[class*="scan-code"] canvas',
          '[class*="qrcode"] img',
          '[class*="qr-code"] img',
          '[class*="qrCode"] img',
          'img[src*="qrcode"]',
          'img[src*="qr_"]',
          'img[src*="qr-"]',
          '[class*="login"] canvas',
          'canvas',  // 最后才用，且必须满足正方形尺寸约束
        ];
        // QR 码约 100-400px 正方形；背景 canvas 通常 800px+，滑块验证宽>高
        const isQrSize = (box) =>
          box.width >= 100 && box.width <= 400 &&
          box.height >= 100 && box.height <= 400;
        // img 元素需确认图片数据已加载（naturalWidth>0），否则截到空白
        const isImgLoaded = async (el) => {
          try {
            const tag = await el.evaluate(e => e.tagName.toLowerCase());
            if (tag !== 'img') return true;
            return await el.evaluate(e => e.complete && e.naturalWidth > 0);
          } catch { return false; }
        };
        let qrEl = null;
        const elDeadline = Date.now() + 45000;
        outer: while (Date.now() < elDeadline) {
          for (const sel of QR_SELECTORS) {
            try {
              const el = await page.$(sel);
              if (el) {
                const box = await el.boundingBox();
                if (box && isQrSize(box) && await isImgLoaded(el)) {
                  process.stderr.write(`[qr-bind-operator:${platform}] 匹配选择器 "${sel}" size=${Math.round(box.width)}x${Math.round(box.height)}\n`);
                  qrEl = el; break outer;
                }
              }
            } catch { /* 继续下一个 */ }
          }
          await new Promise(r => setTimeout(r, 500));
        }

        if (qrEl) {
          process.stderr.write(`[qr-bind-operator:${platform}] QR 元素已找到，发送飞书通知\n`);
          const qrBuf = await qrEl.screenshot({ type: 'png' });
          const notification = await sendFeishuQrCard(platform, qrBuf);
          process.stderr.write(`[qr-bind-operator:${platform}] notification ${notification.status} (delivery not verified)\n`);
          if (process.env.QR_NOTIFICATION_EVIDENCE) {
            const box = await qrEl.boundingBox();
            fs.writeFileSync(process.env.QR_NOTIFICATION_EVIDENCE, JSON.stringify({
              ...notification, platform, run_id: process.env.GITHUB_RUN_ID || '',
              capture: { kind: 'element', width: box?.width, height: box?.height },
            }));
          }
        } else {
          process.stderr.write(`[qr-bind-operator:${platform}] 45s 内未找到 QR 元素，跳过飞书通知\n`);
        }
      } catch (screenshotErr) {
        process.stderr.write(`[qr-bind-operator:${platform}] 截图失败: ${screenshotErr.message}\n`);
      }
    }

    // 轮询 Session Cookie（最长 timeoutMs）
    const targetNames = PLATFORM_SESSION_COOKIES[platform] || [];
    const start = Date.now();
    let logged = false;
    let pollCount = 0;
    while (Date.now() - start < timeoutMs) {
      pollCount++;
      try {
        const rawState = await ctx.storageState();
        const cookies = (rawState && rawState.cookies) || [];
        // 每 20 次（约 30s）打印一次诊断
        if (pollCount % 20 === 1) {
          const found = cookies.filter(c => targetNames.includes(c.name)).map(c => c.name);
          process.stderr.write(
            `[qr-bind-operator:${platform}] poll #${pollCount}: total ${cookies.length} cookies, target found: [${found.join(',')}]\n`
          );
        }
        if (isSessionReady(rawState, platform)) {
          logged = true;
          break;
        }
      } catch (pollErr) {
        process.stderr.write(`[qr-bind-operator:${platform}] poll #${pollCount} error: ${pollErr.message}\n`);
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    if (!logged) {
      // 超时诊断：最后一次 storageState 快照
      try {
        const finalState = await ctx.storageState();
        const allCookieNames = ((finalState && finalState.cookies) || []).map(c => c.name);
        process.stderr.write(
          `[qr-bind-operator:${platform}] timeout after ${pollCount} polls; final cookies: [${allCookieNames.join(',')}]\n`
        );
      } catch (diagErr) {
        process.stderr.write(`[qr-bind-operator:${platform}] timeout; final storageState error: ${diagErr.message}\n`);
      }
      emit({
        ok: false, platform, sessionPath,
        error: `扫码超时（${timeoutMs}ms）— 运营员未在规定时间完成扫码登录`,
      });
      process.exit(1);
      return;
    }

    // 抓取 storageState（cookies + localStorage）
    const storageState = await ctx.storageState();
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    // POST upload-cookies 到中台（platform + cookies 字段）
    const cleanApiBase = (apiBase || '').replace(/\/+$/, '');
    if (cleanApiBase) {
      try {
        const licenseKey = process.env.ZENITHJOY_LICENSE || '';
        const uploadHeaders = { 'Content-Type': 'application/json' };
        if (licenseKey) uploadHeaders['Authorization'] = `Bearer ${licenseKey}`;
        const resp = await fetch(`${cleanApiBase}/api/operator/sessions/upload-cookies`, {
          method: 'POST',
          headers: uploadHeaders,
          body: JSON.stringify({ platform, cookies: storageState }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          process.stderr.write(`[qr-bind-operator:${platform}] upload-cookies HTTP ${resp.status}: ${text}\n`);
        } else {
          process.stderr.write(`[qr-bind-operator:${platform}] upload-cookies 成功\n`);
        }
      } catch (e) {
        process.stderr.write(`[qr-bind-operator:${platform}] upload-cookies error: ${e.message}\n`);
      }
    }

    emit({ ok: true, platform, sessionPath });
    process.exit(0);
  } catch (err) {
    emit({ ok: false, platform, error: String(err) });
    process.exit(1);
  } finally {
    if (!usingCdp && browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch(e => {
  emit({ ok: false, platform, error: String(e) });
  process.exit(1);
});
