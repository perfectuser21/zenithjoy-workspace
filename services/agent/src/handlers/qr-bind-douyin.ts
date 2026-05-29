// services/agent/src/handlers/qr-bind-douyin.ts
//
// Walking Skeleton #1 — 抖音首次扫码绑定
//
// 收到 task `qr_bind_douyin` 时：
//   1. 通过 Playwright launch() 自启动 Chrome（headless:false，用户可见）
//   2. 打开抖音创作者后台，提示用户扫码
//   3. 轮询直到检测到登录成功（默认看 url 是否离开 /login）
//   4. 调 storageState() 把 cookies + origins 序列化，写到
//      ~/.zenithjoy-agent/sessions/douyin/<account_label>.json
//
// Playwright 是运行时依赖（不嵌入 .exe，由客户机 Node 装），所以这里用动态 import
// 同时允许测试注入 chromiumLauncher。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface QrBindDouyinPayload {
  account_label?: string;
}

export interface QrBindDouyinResult {
  ok: boolean;
  sessionPath: string;
  /** WS4: cookie 落地的本地路径（合同 DoD 要求中台回写） */
  cookie_local_path?: string;
  /** WS4: 扫码截屏路径（lead 自验证据 + Dashboard 显示用） */
  qr_screenshot?: string;
  /** WS4: qr_login 阶段标识 */
  qr_login?: 'success' | 'timeout' | 'failed';
  error?: string;
}

export interface ChromiumPage {
  url(): string;
  goto?(url: string): Promise<unknown>;
  // evaluate() lets us check DOM state — essential for SPAs that don't change URL on login
  evaluate?<T>(fn: () => T): Promise<T>;
}

export interface ChromiumContext {
  pages(): ChromiumPage[];
  newPage?(): Promise<ChromiumPage>;
  storageState(): Promise<unknown>;
}

export interface ChromiumBrowser {
  newContext(opts?: Record<string, unknown>): Promise<ChromiumContext>;
  close?(): Promise<void>;
}

export interface ChromiumLauncher {
  launch(opts?: { headless?: boolean; args?: string[] }): Promise<ChromiumBrowser>;
}

export interface QrBindDouyinOptions {
  sessionDir?: string;
  loginUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  headless?: boolean;
  chromiumLauncher?: ChromiumLauncher;
  isLoggedIn?: (ctx: ChromiumContext) => boolean | Promise<boolean>;
}

const DEFAULT_SESSION_DIR_NAME = '.zenithjoy-agent';

export function getSessionPath(
  platform: string,
  accountLabel: string,
  sessionDir?: string,
): string {
  const dir = sessionDir ?? path.join(os.homedir(), DEFAULT_SESSION_DIR_NAME, 'sessions');
  return path.join(dir, platform, `${accountLabel}.json`);
}

/**
 * 判断用户是否已完成抖音创作者后台登录。
 *
 * 抖音创作者中心是 SPA——未登录时 URL 仍是 creator.douyin.com/creator-micro/home，
 * 页面内渲染二维码登录表单，不会跳转到含 /login 的 URL。
 * 不能仅靠 URL 判断登录态，必须用 evaluate() 读取 DOM。
 *
 * 判断逻辑：
 *  1. 若页面内存在"扫码登录"/"二维码"等文字 → 仍在登录界面，返回 false
 *  2. 若在 creator.douyin.com 且上述文字不存在 → 视为登录成功，返回 true
 *  3. evaluate() 不可用（测试注入的 mock page）时，降级为后登录 URL 模式匹配
 */
async function defaultIsLoggedIn(ctx: ChromiumContext): Promise<boolean> {
  const pages = ctx.pages();
  if (pages.length === 0) return false;

  for (const p of pages) {
    const url = p.url();
    if (!url || !/creator\.douyin\.com/.test(url)) continue;
    if (/\/login(\b|\/|$)/i.test(url)) continue;

    const evaluatable = p as { evaluate?: (fn: () => boolean) => Promise<boolean> };
    if (typeof evaluatable.evaluate === 'function') {
      try {
        const stillOnLoginPage = await evaluatable.evaluate(() => {
          const text = (document.body?.textContent ?? '').toLowerCase();
          // 只检测登录页专有文字——'二维码'不可用，已登录的主页也有"扫码下载App"等字样
          const hasLoginText =
            text.includes('扫码登录') ||
            text.includes('请扫码') ||
            text.includes('打开抖音') && text.includes('扫描');
          // class 名含 login 且含 qr 的元素才是真正的登录 QR 框
          const hasLoginQrElem = !!(
            document.querySelector('[class*="loginQr"], [class*="login-qr"], [class*="LoginQr"]') ||
            document.querySelector('[class*="scanLogin"], [class*="scan-login"]')
          );
          // 已登录后才有的元素（正向确认）
          const hasLoggedInElem = !!(
            document.querySelector('[class*="creator-tab"], [class*="sidebar-nav"]') ||
            document.querySelector('[data-e2e="creator-header"]')
          );
          if (hasLoggedInElem) return false;
          return hasLoginText || hasLoginQrElem;
        });
        console.log(`[qr-bind] poll url=${url} stillOnLoginPage=${stillOnLoginPage}`);
        if (!stillOnLoginPage) return true;
      } catch {
        // Page is navigating; skip this cycle
      }
      continue;
    }

    // Fallback for test mocks without evaluate: only trust explicit post-login paths
    if (/\/creator-micro\/(content|material|data|account|fans|revenue)/.test(url)) {
      return true;
    }
  }
  return false;
}

async function loadDefaultLauncher(): Promise<ChromiumLauncher> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const playwright = require('playwright') as { chromium: ChromiumLauncher };
  if (!playwright?.chromium) {
    throw new Error('playwright chromium 未就绪');
  }
  return playwright.chromium;
}

export async function handleQrBindDouyin(
  payload: QrBindDouyinPayload,
  options: QrBindDouyinOptions = {},
): Promise<QrBindDouyinResult> {
  const accountLabel = payload.account_label || 'default';
  const sessionPath = getSessionPath('douyin', accountLabel, options.sessionDir);
  const loginUrl = options.loginUrl ?? 'https://creator.douyin.com/creator-micro/home';
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const headless = options.headless ?? false;
  const isLoggedIn = options.isLoggedIn ?? defaultIsLoggedIn;

  let launcher: ChromiumLauncher;
  try {
    launcher = options.chromiumLauncher ?? (await loadDefaultLauncher());
  } catch (err) {
    return {
      ok: false,
      sessionPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let browser: ChromiumBrowser | null = null;
  try {
    browser = await launcher.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage!();
    await page.goto!(loginUrl);

    // Wait for SPA to fully render before polling (creator.douyin.com takes ~2-3s)
    await new Promise((r) => setTimeout(r, 3000));

    // 等用户扫码登录（轮询）
    const start = Date.now();
    let logged = false;
    while (Date.now() - start < timeoutMs) {
      try {
        const ok = await isLoggedIn(ctx);
        if (ok) {
          logged = true;
          break;
        }
      } catch {
        // ignore one-shot polling errors
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    if (!logged) {
      return {
        ok: false,
        sessionPath,
        qr_login: 'timeout',
        error: `qr-bind timeout after ${timeoutMs}ms — 用户未完成扫码登录`,
      };
    }

    const storageState = await ctx.storageState();

    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    // WS4: 中台 result 含 cookie_local_path + qr_login 状态（合同 DoD）
    return {
      ok: true,
      sessionPath,
      cookie_local_path: sessionPath,
      qr_login: 'success',
    };
  } catch (err) {
    return {
      ok: false,
      sessionPath,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await browser?.close?.();
    } catch {
      // ignore
    }
  }
}
