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
//
// 注：生产路径通过 spawn publishers/qr-bind-douyin-burner.cjs 实现，
//     绕过 pkg 二进制内 require('playwright')/import('playwright-core') 在 Node 18+ 的
//     "Invalid host defined options" 崩溃（真机打包版上一直崩，binary 内 dynamic import
//     playwright-core 也崩；唯一能跑通的是 spawn 外部 .cjs 从真实文件系统 require）。
//     测试路径（options.chromiumLauncher 注入）仍走内部逻辑，保持单元测试可控。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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

// 解析外部脚本路径（与 qr-bind-operator.ts 相同的查找逻辑）
export function resolveBurnerScript(): string {
  // pkg 场景：脚本与 .exe 同目录的 publishers/
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'qr-bind-douyin-burner.cjs');
  if (fs.existsSync(beside)) return beside;
  // 开发场景：从 __dirname 推导（src/handlers → ../../publishers）
  const dev = path.resolve(__dirname, '..', '..', 'publishers', 'qr-bind-douyin-burner.cjs');
  return dev;
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

// 生产路径：spawn 外部 Node.js 进程跑 .cjs（绕过 pkg+playwright 崩溃），读最后一行 JSON 当结果。
async function spawnBurnerProcess(
  accountLabel: string,
  sessionDir: string,
  userDataDirRoot: string,
  timeoutMs: number,
  fallbackSessionPath: string,
): Promise<QrBindDouyinBurnerResult> {
  const scriptPath = resolveBurnerScript();
  const nodeExe = resolveNodeExe();
  const args = [scriptPath, accountLabel, sessionDir, userDataDirRoot, String(timeoutMs)];

  return new Promise<QrBindDouyinBurnerResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, args, {
      env: { ...process.env },
      timeout: timeoutMs + 15000,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => {
      console.log('[qr-bind-douyin-burner]', d.toString().trimEnd());
    });
    proc.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as QrBindDouyinBurnerResult);
      } catch {
        resolve({
          ok: false,
          sessionPath: fallbackSessionPath,
          qr_login: 'failed',
          error: `result parse failed: ${lastLine || '(no output)'}`,
        });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({
        ok: false,
        sessionPath: fallbackSessionPath,
        qr_login: 'failed',
        error: `spawn failed: ${err.message}`,
      });
    });
  });
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

  // 生产路径：spawn 外部 .cjs（绕过 pkg+playwright 崩溃）。
  // 测试路径：注入 chromiumLauncher 时走下方内部逻辑。
  if (!options.chromiumLauncher) {
    const COOKIE_POLL_TIMEOUT_MS = 600000; // 10 分钟，与内部逻辑一致
    return spawnBurnerProcess(
      accountLabel,
      options.sessionDir ?? path.join(os.homedir(), DEFAULT_SESSION_DIR_NAME, 'sessions'),
      options.userDataDirRoot ?? '',
      COOKIE_POLL_TIMEOUT_MS,
      sessionPath,
    );
  }

  // ── 以下为测试专用内部路径（options.chromiumLauncher 注入）──
  const userDataDir = getBurnerUserDataDir(accountLabel, options.userDataDirRoot);
  const loginUrl = options.loginUrl ?? 'https://creator.douyin.com/';
  const channel = options.channel ?? 'msedge';
  const headless = options.headless ?? false; // 真扫码需要 user 看见浏览器；headless true 仅 lead 自验有桌面

  const launcher: ChromiumLauncher = options.chromiumLauncher;

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

    // 等扫码完成：轮询 storageState cookie 直到出现抖音 session cookie (sessionid_ss / sessionid / sid_tt)。
    // timeout 10 分钟（600000ms）— 给客户找小号手机时间。
    //
    // 替代旧 waitForURL(/^(?!.*\/login).*$/, {timeout: 600000}) 逻辑 —
    // 旧 urlMatcher 是 "URL 不含 /login" 立即匹配，初始页 creator.douyin.com/ 就不含 /login →
    // waitForURL 立即返回 → handler 没真等扫码就标 success。
    // 新 cookie polling 直接看抖音真登录 cookie 写入，是真扫码完成的唯一可靠信号。
    const COOKIE_POLL_INTERVAL_MS = 2000;
    const COOKIE_POLL_TIMEOUT_MS = 600000;
    const SESSION_COOKIE_NAMES = ['sessionid_ss', 'sessionid', 'sid_tt'];
    const isSessionCookie = (c: { name: string; domain: string; value: string }) =>
      typeof c?.value === 'string' &&
      c.value.length > 0 &&
      typeof c?.domain === 'string' &&
      (c.domain.endsWith('.douyin.com') || c.domain === 'douyin.com') &&
      SESSION_COOKIE_NAMES.includes(c.name);
    const start = Date.now();
    type CookieEntry = { name: string; domain: string; value: string };
    type StorageStateShape = { cookies?: CookieEntry[] };
    let storageState: StorageStateShape = {};
    while (Date.now() - start < COOKIE_POLL_TIMEOUT_MS) {
      const raw = await context.storageState();
      storageState = (raw ?? {}) as StorageStateShape;
      const cookies: CookieEntry[] = storageState.cookies ?? [];
      if (cookies.some(isSessionCookie)) break;
      await new Promise((r) => setTimeout(r, COOKIE_POLL_INTERVAL_MS));
    }
    const finalCookies: CookieEntry[] = storageState.cookies ?? [];
    if (!finalCookies.some(isSessionCookie)) {
      throw new Error('timeout waiting for douyin login (sessionid cookie missing after 600s)');
    }

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
