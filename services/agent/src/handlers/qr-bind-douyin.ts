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
import { spawn } from 'node:child_process';

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

function resolveQrBindDouyinScript(): string {
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'qr-bind-douyin.cjs');
  if (fs.existsSync(beside)) return beside;
  const dev = path.resolve(__dirname, '..', '..', 'publishers', 'qr-bind-douyin.cjs');
  return dev;
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

async function spawnQrBindDouyin(
  accountLabel: string,
  sessionDir: string | undefined,
  timeoutMs: number,
): Promise<QrBindDouyinResult> {
  const sessionPath = getSessionPath('douyin', accountLabel, sessionDir);
  const scriptPath = resolveQrBindDouyinScript();
  const nodeExe = resolveNodeExe();

  return new Promise<QrBindDouyinResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, [scriptPath, accountLabel, sessionDir ?? '', String(timeoutMs)], {
      env: { ...process.env },
      timeout: timeoutMs + 15000,
    });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => {
      console.log('[qr-bind-douyin]', d.toString().trimEnd());
    });
    proc.on('close', (_code: number) => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as QrBindDouyinResult);
      } catch {
        resolve({ ok: false, sessionPath, error: `result parse failed: ${lastLine || '(no output)'}` });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({ ok: false, sessionPath, error: `spawn failed: ${err.message}` });
    });
  });
}

export async function handleQrBindDouyin(
  payload: QrBindDouyinPayload,
  options: QrBindDouyinOptions = {},
): Promise<QrBindDouyinResult> {
  const accountLabel = payload.account_label || 'default';
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  // 生产路径：spawn 外部进程（绕过 pkg+playwright 崩溃）
  // 测试路径：注入 chromiumLauncher 时走内部逻辑
  if (!options.chromiumLauncher) {
    return spawnQrBindDouyin(accountLabel, options.sessionDir, timeoutMs);
  }

  // ── 以下为测试专用内部路径（options.chromiumLauncher 注入）──
  const sessionPath = getSessionPath('douyin', accountLabel, options.sessionDir);
  const loginUrl = options.loginUrl ?? 'https://creator.douyin.com/creator-micro/home';
  const pollIntervalMs = options.pollIntervalMs ?? 1500;
  const headless = options.headless ?? false;
  const launcher = options.chromiumLauncher;

  let browser: ChromiumBrowser | null = null;
  try {
    browser = await launcher.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage!();
    await page.goto!(loginUrl);

    const SESSION_COOKIE_NAMES = ['sessionid_ss', 'sessionid', 'sid_tt'];
    const isSessionCookie = (c: { name: string; domain: string; value: string }) =>
      typeof c?.value === 'string' &&
      c.value.length > 0 &&
      typeof c?.domain === 'string' &&
      (c.domain.endsWith('.douyin.com') || c.domain === 'douyin.com') &&
      SESSION_COOKIE_NAMES.includes(c.name);

    type CookieEntry = { name: string; domain: string; value: string };
    type StorageStateShape = { cookies?: CookieEntry[] };
    let storageState: StorageStateShape = {};
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const raw = await ctx.storageState();
      storageState = (raw ?? {}) as StorageStateShape;
      const cookies: CookieEntry[] = storageState.cookies ?? [];
      if (cookies.some(isSessionCookie)) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    if (!(storageState.cookies ?? []).some(isSessionCookie)) {
      return {
        ok: false,
        sessionPath,
        qr_login: 'timeout',
        error: `qr-bind timeout after ${timeoutMs}ms — 用户未完成扫码登录`,
      };
    }

    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

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
