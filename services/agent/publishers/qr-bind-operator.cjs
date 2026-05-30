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

async function sendFeishuQrCard(platform, screenshotBuffer) {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) return;

  try {
    // 1. 拿 app_access_token
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (!tokenRes.ok) throw new Error(`token API HTTP ${tokenRes.status}`);
    const tokenJson = await tokenRes.json();
    const token = tokenJson.app_access_token;
    if (!token) throw new Error(`token 获取失败: ${JSON.stringify(tokenJson)}`);

    // 2. 上传图片（FormData/Blob 在 Node.js 18+ 是全局变量）
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([screenshotBuffer], { type: 'image/png' }), 'qr.png');
    const imgRes = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!imgRes.ok) throw new Error(`图片上传 HTTP ${imgRes.status}`);
    const imgJson = await imgRes.json();
    const imageKey = imgJson.data?.image_key;
    if (!imageKey) throw new Error(`图片上传失败: ${JSON.stringify(imgJson)}`);

    // 3. 发飞书互动卡片
    const PLATFORM_DISPLAY = {
      douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书',
      shipinhao: '视频号', toutiao: '头条', weibo: '微博',
      zhihu: '知乎', gongzhonghao: '公众号',
    };
    const displayName = PLATFORM_DISPLAY[platform] || platform;
    const card = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: `🔑 ${displayName} 扫码绑定请求` }, template: 'blue' },
        elements: [
          { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '二维码' } },
          { tag: 'div', text: { tag: 'plain_text', content: '请在 3 分钟内用手机扫描上方二维码' } },
        ],
      },
    };
    const cardRes = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });
    if (!cardRes.ok) throw new Error(`飞书卡片推送 HTTP ${cardRes.status}`);
    process.stderr.write(`[qr-bind-operator:${platform}] 飞书 QR 卡片已发送\n`);
  } catch (e) {
    process.stderr.write(`[qr-bind-operator:${platform}] 飞书推送失败（不影响扫码）: ${e.message}\n`);
  }
}

const [,, platform, apiBase = '', accountLabel = 'default', timeoutMsStr = '300000'] = process.argv;
const timeoutMs = parseInt(timeoutMsStr, 10) || 300000;
const CDP_PORT = parseInt(process.env.ZENITHJOY_CHROME_DEBUG_PORT || '19222', 10);

const PLATFORM_SESSION_COOKIES = {
  douyin:       ['sessionid_ss', 'sessionid', 'sid_tt'],
  toutiao:      ['sessionid', 'sid_tt'],
  kuaishou:     ['userId', 'kuaishou.sid', 'passToken'],
  xiaohongshu:  ['web_session', 'webId'],
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

    // 等登录页出现 → 等 QR 元素可见 → 只截 QR 元素（失败不影响主流程）
    if (page) {
      try {
        // 等重定向到登录页（最多 12s）
        const loginDeadline = Date.now() + 12000;
        while (Date.now() < loginDeadline) {
          if (/\/login(\b|\/|$)/i.test(page.url())) break;
          await new Promise(r => setTimeout(r, 500));
        }

        if (/\/login(\b|\/|$)/i.test(page.url())) {
          // 逐个选择器寻找 QR 码元素（最多等 15s）
          const QR_SELECTORS = [
            'canvas',
            'img[src*="qrcode"]',
            'img[src*="qr_"]',
            '[class*="qr-code"] canvas',
            '[class*="qrCode"] canvas',
            '[class*="qrcode"] canvas',
            '[class*="qr-code"] img',
            '[class*="login"] canvas',
          ];
          let qrEl = null;
          const elDeadline = Date.now() + 15000;
          outer: while (Date.now() < elDeadline) {
            for (const sel of QR_SELECTORS) {
              try {
                const el = await page.$(sel);
                if (el) {
                  const box = await el.boundingBox();
                  if (box && box.width >= 80) { qrEl = el; break outer; }
                }
              } catch { /* 继续下一个 */ }
            }
            await new Promise(r => setTimeout(r, 500));
          }

          process.stderr.write(`[qr-bind-operator:${platform}] QR 元素${qrEl ? '已找到' : '未找到，回退全屏'}\n`);
          const qrBuf = qrEl
            ? await qrEl.screenshot({ type: 'png' })
            : await page.screenshot({ type: 'png', fullPage: false });
          await sendFeishuQrCard(platform, qrBuf);
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
