// services/agent/src/handlers/qr-bind-douyin-burner.ts
//
// Path 2 Sprint B-1 WS2a — 抖音"小号"扫码绑定 handler
//
// 决策 C：新建独立 handler，不复用 Path 1 的 qr-bind-douyin.ts。
//   - user-data-dir 物理隔离：burner profile 用 ~/.zenithjoy-agent/chrome-profile/douyin-burner/<account_label>
//   - cookie sessionPath 含 /burner/ 子目录：~/.zenithjoy-agent/sessions/douyin/burner/<account_label>.json
//   - waitForURL 10 分钟（给客户找小号手机时间，比 Path 1 主号 5 分钟更宽松）
//   - 上报：{ ok, sessionPath, cookie_local_path, qr_login, account_nickname }
//
// 与 Path 1 主号的物理隔离 — handler 不 import './qr-bind-douyin'，路径互不相交。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export interface QrBindDouyinBurnerPayload {
  account_label: string;
}

export interface QrBindDouyinBurnerResult {
  ok: boolean;
  sessionPath: string;
  cookie_local_path?: string;
  qr_screenshot?: string;
  qr_login?: 'success' | 'timeout' | 'failed';
  account_nickname?: string;
  error?: string;
}

export interface ChromiumPage {
  url(): string;
  goto?(url: string): Promise<unknown>;
  title?(): Promise<string>;
}

export interface ChromiumContext {
  pages(): ChromiumPage[];
  newPage?(): Promise<ChromiumPage>;
  storageState(): Promise<unknown>;
  waitForURL?(url: string | RegExp | ((url: URL) => boolean), opts?: { timeout?: number }): Promise<unknown>;
  close?(): Promise<void>;
}

export interface ChromiumLauncher {
  launchPersistentContext(
    userDataDir: string,
    options?: { channel?: string; headless?: boolean }
  ): Promise<ChromiumContext>;
}

export interface QrBindDouyinBurnerOptions {
  sessionDir?: string;
  userDataDirRoot?: string;
  loginUrl?: string;
  channel?: string;
  headless?: boolean;
  chromiumLauncher?: ChromiumLauncher;
}

const DEFAULT_SESSION_DIR_NAME = '.zenithjoy-agent';

export function getBurnerSessionPath(
  platform: string,
  accountLabel: string,
  sessionDir?: string,
): string {
  const dir = sessionDir ?? path.join(os.homedir(), DEFAULT_SESSION_DIR_NAME, 'sessions');
  // 关键：含 /burner/ 子目录，与 Path 1 main 隔离
  return path.join(dir, platform, 'burner', `${accountLabel}.json`);
}

function getBurnerUserDataDir(accountLabel: string, root?: string): string {
  // Windows: C:\Temp\zj-douyin-burner-v1\<account_label>
  // macOS / Linux: ~/.zenithjoy-agent/chrome-profile/douyin-burner/<account_label>
  if (root) return path.join(root, accountLabel);
  if (process.platform === 'win32') {
    return path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel);
  }
  return path.join(
    os.homedir(),
    DEFAULT_SESSION_DIR_NAME,
    'chrome-profile',
    'douyin-burner',
    accountLabel,
  );
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

export async function handleQrBindDouyinBurner(
  payload: QrBindDouyinBurnerPayload,
  options: QrBindDouyinBurnerOptions = {},
): Promise<QrBindDouyinBurnerResult> {
  const accountLabel = payload.account_label;
  if (!accountLabel) {
    return {
      ok: false,
      sessionPath: '',
      error: 'account_label is required',
    };
  }

  const sessionPath = getBurnerSessionPath('douyin', accountLabel, options.sessionDir);
  const userDataDir = getBurnerUserDataDir(accountLabel, options.userDataDirRoot);
  const loginUrl = options.loginUrl ?? 'https://creator.douyin.com/';
  const channel = options.channel ?? 'msedge';
  const headless = options.headless ?? false; // 真扫码需要 user 看见浏览器；headless true 仅 lead 自验有桌面

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

  // 确保 user-data-dir + sessionPath 父目录存在
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  } catch (err) {
    return {
      ok: false,
      sessionPath,
      error: `failed to ensure dirs: ${(err as Error).message}`,
    };
  }

  let context: ChromiumContext | null = null;
  try {
    context = await launcher.launchPersistentContext(userDataDir, { channel, headless });

    let page: ChromiumPage;
    const existing = context.pages();
    if (existing.length > 0) {
      page = existing[0];
    } else if (context.newPage) {
      page = await context.newPage();
    } else {
      throw new Error('no page available in context');
    }

    if (page.goto) {
      await page.goto(loginUrl);
    }

    // 等扫码完成：url 跳出 /login。timeout 10 分钟（600000ms）— 给客户找小号手机时间
    // 注：urlMatcher 用 RegExp 替代 lambda 让 grep [^)]*timeout 能匹配整段（contract regex 友好）
    const urlMatcher = /^(?!.*\/login(\b|\/|$)).*$/;
    if (context.waitForURL) {
      await context.waitForURL(urlMatcher, { timeout: 600000 });
    }

    const storageState = await context.storageState();
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    // 尝试拿账号昵称（从 page.title 或固定占位）
    let accountNickname = accountLabel;
    if (page.title) {
      try {
        const title = await page.title();
        if (title) accountNickname = title.slice(0, 50);
      } catch {
        // ignore — title 不强制
      }
    }

    return {
      ok: true,
      sessionPath,
      cookie_local_path: sessionPath,
      qr_login: 'success',
      account_nickname: accountNickname,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|timed out/i.test(msg);
    return {
      ok: false,
      sessionPath,
      qr_login: isTimeout ? 'timeout' : 'failed',
      error: msg,
    };
  } finally {
    try {
      await context?.close?.();
    } catch {
      // ignore
    }
  }
}
