// services/agent/src/handlers/qr-bind-operator.ts
//
// 运营中枢 Session 绑定 — 8 平台统一 handler（CDP优先 + launch 回退 + 5min 超时 + POST upload-cookies）
//
// 收到 task `qr_bind/{platform}` 时：
//   1. 优先 connectOverCDP(localhost:19222) 接管已有 Chrome（xian-pc 常驻），失败则 launch() 新开
//   2. 导航至对应平台 creator URL，等待运营员手机扫码登录
//   3. 检测 Session Cookie 出现（比 URL 检测可靠，避免 SPA 初始路由误判已登录）
//   4. 调 storageState() 抓取 cookies
//   5. POST ZENITHJOY_API_BASE/api/operator/sessions/upload-cookies（{platform, cookies}）
//   6. 返回 {ok: true} 或超时 {ok: false, error: 'timeout'}
//   7. CDP 模式下仅断开连接，不关闭浏览器（xian-pc 窗口保持可见）

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// xian-pc 常驻 Chrome 远程调试端口（chrome.exe --remote-debugging-port=19222）
const CDP_PORT = 19222;

// 各平台登录后必然出现的 Session Cookie 名（优先于 URL 检测，避免 SPA 误判）
const PLATFORM_SESSION_COOKIES: Record<string, string[]> = {
  douyin:       ['sessionid_ss', 'sessionid', 'sid_tt'],
  toutiao:      ['sessionid', 'sid_tt'],
  kuaishou:     ['userId', 'kuaishou.sid', 'passToken'],
  xiaohongshu:  ['web_session', 'webId'],
  weibo:        ['SUB', 'SUBP'],
  zhihu:        ['z_c0', 'SESSIONID'],
  shipinhao:    ['skey', 'uin'],
  gongzhonghao: ['skey', 'uin'],
};

// 8 平台 creator URL — 用会触发 /login 重定向的子路径
export const PLATFORM_CREATOR_URLS: Record<string, string> = {
  douyin:       'https://creator.douyin.com/creator-micro/home',
  kuaishou:     'https://cp.kuaishou.com/article/publish/video',
  xiaohongshu:  'https://creator.xiaohongshu.com/publish/publish',
  shipinhao:    'https://channels.weixin.qq.com/platform/login',
  toutiao:      'https://mp.toutiao.com/profile_v4/graphic/publish',
  weibo:        'https://weibo.com/login.php',
  zhihu:        'https://www.zhihu.com/creator',
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
  isSessionReady?: (storageState: Record<string, unknown>, platform: string) => boolean;
  sessionBaseDir?: string;
}

const DEFAULT_SESSION_DIR_NAME = '.zenithjoy-agent';

function getSessionPath(platform: string, accountLabel: string, baseDir?: string): string {
  const dir = baseDir ?? path.join(os.homedir(), DEFAULT_SESSION_DIR_NAME, 'sessions');
  return path.join(dir, 'operator', platform, `${accountLabel}.json`);
}

type CookieEntry = { name: string; domain: string; value: string };
type StorageStateShape = { cookies?: CookieEntry[] };

function defaultIsSessionReady(storageState: Record<string, unknown>, platform: string): boolean {
  const cookieNames = PLATFORM_SESSION_COOKIES[platform] ?? [];
  if (cookieNames.length === 0) return false;
  const cookies = ((storageState as StorageStateShape).cookies ?? []);
  return cookies.some(
    (c) => typeof c.value === 'string' && c.value.length > 0 && cookieNames.includes(c.name),
  );
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
  const isSessionReady = options.isSessionReady ?? defaultIsSessionReady;
  const sessionPath = getSessionPath(platform, accountLabel, options.sessionBaseDir);

  const apiBase = (payloadApiBase ?? process.env.ZENITHJOY_API_BASE ?? '').replace(/\/+$/, '');

  let launcher: ChromiumLauncher;
  try {
    launcher = options.chromiumLauncher ?? (await loadDefaultLauncher());
  } catch (err) {
    return { ok: false, platform, error: err instanceof Error ? err.message : String(err) };
  }

  let browser: ChromiumBrowser | null = null;
  let usingCdp = false;

  try {
    // CDP 优先：接管 xian-pc 上已有的 Chrome（port 19222），失败时降级 launch
    try {
      browser = await launcher.connectOverCDP(`http://localhost:${CDP_PORT}`);
      usingCdp = true;
      console.log(`[qr-bind-operator:${platform}] CDP 连接成功 (port ${CDP_PORT})`);
    } catch {
      browser = await launcher.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      console.log(`[qr-bind-operator:${platform}] CDP 不可用，已 launch 新 Chrome`);
    }

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

    // 等待页面稳定（SPA 需要 JS 执行后才完成路由，3s 与测试契约对齐）
    await new Promise((r) => setTimeout(r, 3000));

    // 轮询 Session Cookie（最长 5min）— Cookie 检测比 URL 更可靠，不受 SPA 中间路由误判
    const start = Date.now();
    let logged = false;
    while (Date.now() - start < timeoutMs) {
      try {
        const rawState = await ctx.storageState();
        if (isSessionReady(rawState as Record<string, unknown>, platform)) {
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
      if (!usingCdp) {
        // launch 模式：关闭我们自己开的 Chrome
        await browser?.close?.();
      }
      // CDP 模式：不关闭 Chrome（xian-pc 窗口保持可见，员工可继续使用）
    } catch {
      // 关闭失败忽略
    }
  }
}
