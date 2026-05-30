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

    const ctx = browser.newContext ? await browser.newContext() : browser.contexts()[0];
    if (!ctx) {
      emit({ ok: false, platform, error: 'Chrome 启动后无法获取 context' });
      process.exit(1);
      return;
    }

    const creatorUrl = PLATFORM_CREATOR_URLS[platform];
    const pages = ctx.pages ? ctx.pages() : [];
    const page = pages[0] || (ctx.newPage ? await ctx.newPage() : null);
    if (page && page.goto) {
      await page.goto(creatorUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }

    // 等待 SPA 完成重定向再开始轮询（抖音等框架需 3s JS 执行）
    await new Promise(r => setTimeout(r, 3000));

    // 轮询 Session Cookie（最长 timeoutMs）
    const start = Date.now();
    let logged = false;
    while (Date.now() - start < timeoutMs) {
      try {
        const rawState = await ctx.storageState();
        if (isSessionReady(rawState, platform)) {
          logged = true;
          break;
        }
      } catch { /* 忽略单次轮询错误 */ }
      await new Promise(r => setTimeout(r, 1500));
    }

    if (!logged) {
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
        const resp = await fetch(`${cleanApiBase}/api/operator/sessions/upload-cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
