// services/agent/src/handlers/qr-bind-operator.ts
//
// 运营中枢 Session 绑定 — 8 平台统一 handler（CDP 19222 + 5min 超时 + POST upload-cookies）
//
// 收到 task `qr_bind/{platform}` 时：
//   1. CDP 连接本地 Chrome 19222
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
  goto?(url: string): Promise<unknown>;
}

export interface ChromiumContext {
  pages(): ChromiumPage[];
  newPage?(): Promise<ChromiumPage>;
  storageState(): Promise<unknown>;
}

export interface ChromiumBrowser {
  contexts(): ChromiumContext[];
  close?(): Promise<void>;
}

export interface ChromiumLauncher {
  connectOverCDP(url: string): Promise<ChromiumBrowser>;
}

export interface QrBindOperatorOptions {
  cdpPort?: number;
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
  const moduleName = 'playwright';
  let playwright: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    playwright = await dynImport(moduleName);
  } catch {
    playwright = null;
  }
  if (!playwright?.chromium) {
    throw new Error('playwright 未安装；客户机需先装 playwright (npm i playwright)');
  }
  return playwright.chromium as ChromiumLauncher;
}

export async function handleQrBindOperator(
  payload: QrBindOperatorPayload,
  options: QrBindOperatorOptions = {},
): Promise<QrBindOperatorResult> {
  const { platform, account_label: accountLabel = 'default', api_base: payloadApiBase } = payload;
  if (!platform || !PLATFORM_CREATOR_URLS[platform]) {
    return { ok: false, platform, error: `不支持的平台: ${platform}` };
  }

  const cdpPort = options.cdpPort ?? 19222;
  const cdpUrl = `http://localhost:${cdpPort}`;
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
    browser = await launcher.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      return { ok: false, platform, error: `CDP 没有 context，确认 Chrome ${cdpPort} 是否已启动` };
    }
    const ctx = contexts[0];

    // 导航到平台创作者页面（如果已打开则跳过）
    const creatorUrl = PLATFORM_CREATOR_URLS[platform];
    const pages = ctx.pages();
    const alreadyOnPlatform = pages.some((p) => p.url().includes(new URL(creatorUrl).hostname));
    if (!alreadyOnPlatform && pages[0]?.goto) {
      await pages[0].goto(creatorUrl);
    }

    // 轮询等待扫码登录（最长 5min = 300000ms）
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

    // POST upload-cookies 到中台（含 platform + cookies 字段）
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
        // upload-cookies 失败时 fallback 写本地，不阻塞成功结果
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
      // CDP 断连忽略
    }
  }
}
