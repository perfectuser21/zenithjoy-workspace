// services/agent/src/handlers/qr-bind-douyin.ts
//
// Walking Skeleton #1 — 抖音首次扫码绑定
//
// 收到 task `qr_bind/douyin` 时：
//   1. 通过 Playwright 接到 CDP 19222（用户已经在该端口跑着 Chrome 实例，由 Agent
//      启动器或客户手动开起来）
//   2. 把抖音创作者后台打开，提示用户扫码
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

export interface QrBindDouyinOptions {
  cdpPort?: number;
  sessionDir?: string;
  loginUrl?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
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

function defaultIsLoggedIn(ctx: ChromiumContext): boolean {
  const pages = ctx.pages();
  if (pages.length === 0) return false;
  // 抖音创作者后台登录后 url 中不再含 '/login'（首页是 /creator-micro/home 等）
  const inLogin = pages.some((p) => /\/login(\b|\/|$)/.test(p.url()));
  if (inLogin) return false;
  // 至少一个页面落在 douyin.com 域名 → 视为登录成功
  return pages.some((p) => /douyin\.com/.test(p.url()));
}

async function loadDefaultLauncher(): Promise<ChromiumLauncher> {
  // 动态 import 避免 pkg 打包尝试 bundle playwright（playwright 不在 .exe 里，
  // 客户机需自装）。用变量名 + Function 包装跳过 TS 静态解析，避免开发环境
  // 没装 playwright 时 typecheck 报错。
  const moduleName = 'playwright';
  let playwright: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const dynImport = new Function('m', 'return import(m)') as (
      m: string,
    ) => Promise<any>;
    playwright = await dynImport(moduleName);
  } catch {
    playwright = null;
  }
  if (!playwright?.chromium) {
    throw new Error('playwright 未安装；客户机需先装 playwright (npm i playwright)');
  }
  return playwright.chromium as ChromiumLauncher;
}

export async function handleQrBindDouyin(
  payload: QrBindDouyinPayload,
  options: QrBindDouyinOptions = {},
): Promise<QrBindDouyinResult> {
  const accountLabel = payload.account_label || 'default';
  const sessionPath = getSessionPath('douyin', accountLabel, options.sessionDir);
  const cdpPort = options.cdpPort ?? 19222;
  const cdpUrl = `http://localhost:${cdpPort}`;
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
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
    browser = await launcher.connectOverCDP(cdpUrl);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      return {
        ok: false,
        sessionPath,
        error: 'CDP 没有 context，确认 Chrome 19222 是否已启动并打开抖音页',
      };
    }
    const ctx = contexts[0];

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
    // CDP 连接关闭只断开本地 socket，不会关用户 Chrome
    try {
      await browser?.close?.();
    } catch {
      // ignore
    }
  }
}
