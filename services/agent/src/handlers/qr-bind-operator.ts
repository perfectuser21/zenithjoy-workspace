// services/agent/src/handlers/qr-bind-operator.ts
//
// 运营中枢 Session 绑定 — 8 平台统一 handler（launch Chrome + 5min 超时 + POST upload-cookies）
//
// 收到 task `qr_bind/{platform}` 时：
//   1. Playwright launch() 启动 Chrome（headless:false，运营员可见）
//   2. 导航至对应平台 creator URL，等待运营员手机扫码登录
//   3. 检测 URL 离开登录页（视为登录成功）
//   4. 调 storageState() 抓取 cookies
//   5. POST ZENITHJOY_API_BASE/api/operator/sessions/upload-cookies（{platform, cookies}）
//   6. 返回 {ok: true} 或超时 {ok: false, error: 'timeout'}

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// 8 平台 creator URL 映射
export const PLATFORM_CREATOR_URLS: Record<string, string> = {
  douyin: 'https://creator.douyin.com',
  kuaishou: 'https://cp.kuaishou.com',
  xiaohongshu: 'https://creator.xiaohongshu.com',
  shipinhao: 'https://channels.weixin.qq.com/platform/login',
  toutiao: 'https://mp.toutiao.com',
  weibo: 'https://weibo.com/login.php',
  zhihu: 'https://www.zhihu.com/creator',
  gongzhonghao: 'https://mp.weixin.qq.com',
};

export interface QrBindOperatorPayload {
  platform: string;
  account_label?: string;
  api_base?: string;
}

export interface QrBindOperatorResult {
  ok: boolean;
  platform?: string;
  sessionPath?: string;
  error?: string;
}

export interface ChromiumPage {
  url(): string;
  goto?(url: string, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface ChromiumContext {
  pages(): ChromiumPage[];
  newPage?(): Promise<ChromiumPage>;
  storageState(): Promise<unknown>;
}

export interface ChromiumBrowser {
  contexts(): ChromiumContext[];
  newContext?(): Promise<ChromiumContext>;
  close?(): Promise<void>;
}

export interface ChromiumLauncher {
  connectOverCDP(url: string): Promise<ChromiumBrowser>;
  launch(opts?: { headless?: boolean; args?: string[] }): Promise<ChromiumBrowser>;
}

export interface QrBindOperatorOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  chromiumLauncher?: ChromiumLauncher;
  isLoggedIn?: (ctx: ChromiumContext, platform: string) => boolean | Promise<boolean>;
  sessionBaseDir?: string;
}

const DEFAULT_SESSION_DIR_NAME = '.zenithjoy-agent';

function getSessionPath(platform: string, accountLabel: string, baseDir?: string): string {
  const dir = baseDir ?? path.join(os.homedir(), DEFAULT_SESSION_DIR_NAME, 'sessions');
  return path.join(dir, 'operator', platform, `${accountLabel}.json`);
}

function defaultIsLoggedIn(ctx: ChromiumContext, platform: string): boolean {
  const pages = ctx.pages();
  if (pages.length === 0) return false;
  const creatorUrl = PLATFORM_CREATOR_URLS[platform] || '';
  const creatorHost = creatorUrl ? new URL(creatorUrl).hostname : '';
  return pages.some((p) => {
    const url = p.url();
    if (/\/login(\b|\/|$)/.test(url)) return false;
    if (creatorHost && !url.includes(creatorHost)) return false;
    return true;
  });
}

async function loadDefaultLauncher(): Promise<ChromiumLauncher> {
  const playwright = require('playwright') as { chromium: ChromiumLauncher };
  if (!playwright?.chromium) {
    throw new Error('playwright 未安装；客户机需先装 playwright (npm i playwright)');
  }
  return playwright.chromium;
}

export async function handleQrBindOperator(
  payload: QrBindOperatorPayload,
  options: QrBindOperatorOptions = {},
): Promise<QrBindOperatorResult> {
  const { platform, account_label: accountLabel = 'default', api_base: payloadApiBase } = payload;
  if (!platform || !PLATFORM_CREATOR_URLS[platform]) {
    return { ok: false, platform, error: `不支持的平台: ${platform}` };
  }

  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 300000; // 5 * 60 * 1000
  const isLoggedIn = options.isLoggedIn ?? defaultIsLoggedIn;
  const sessionPath = getSessionPath(platform, accountLabel, options.sessionBaseDir);

  const apiBase = (payloadApiBase ?? process.env.ZENITHJOY_API_BASE ?? '').replace(/\/+$/, '');

  let launcher: ChromiumLauncher;
  try {
    launcher = options.chromiumLauncher ?? (await loadDefaultLauncher());
  } catch (err) {
    return { ok: false, platform, error: err instanceof Error ? err.message : String(err) };
  }

  let browser: ChromiumBrowser | null = null;
  try {
    browser = await launcher.launch({ headless: false });
    const ctx = browser.newContext
      ? await browser.newContext()
      : browser.contexts()[0];

    if (!ctx) {
      return { ok: false, platform, error: 'Chrome 启动后无法获取 context' };
    }

    const creatorUrl = PLATFORM_CREATOR_URLS[platform];
    const page = ctx.pages()[0] ?? (ctx.newPage ? await ctx.newPage() : null);
    if (page?.goto) {
      await page.goto(creatorUrl, { waitUntil: 'domcontentloaded' } as Record<string, unknown>);
    }

    // 轮询等待扫码登录（最长 5min）
    const start = Date.now();
    let logged = false;
    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await isLoggedIn(ctx, platform);
        if (ok) {
          logged = true;
          break;
        }
      } catch {
        // 忽略单次轮询错误
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    if (!logged) {
      return {
        ok: false,
        platform,
        sessionPath,
        error: `扫码超时（${timeoutMs}ms）— 运营员未在规定时间完成扫码登录`,
      };
    }

    // 抓取 storageState（cookies + localStorage）
    const storageState = await ctx.storageState();
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    // POST upload-cookies 到中台
    if (apiBase) {
      try {
        const resp = await fetch(`${apiBase}/api/operator/sessions/upload-cookies`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, cookies: storageState }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          console.warn(`[qr-bind-operator:${platform}] upload-cookies HTTP ${resp.status}: ${text}`);
        } else {
          console.log(`[qr-bind-operator:${platform}] upload-cookies 成功`);
        }
      } catch (err) {
        console.warn(`[qr-bind-operator:${platform}] upload-cookies 网络错误:`, (err as Error).message);
      }
    } else {
      console.warn(`[qr-bind-operator:${platform}] 无 ZENITHJOY_API_BASE，跳过 upload-cookies（已写本地 ${sessionPath}）`);
    }

    return { ok: true, platform, sessionPath };
  } catch (err) {
    return { ok: false, platform, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await browser?.close?.();
    } catch {
      // 关闭失败忽略
    }
  }
}
