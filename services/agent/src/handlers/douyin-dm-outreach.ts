// services/agent/src/handlers/douyin-dm-outreach.ts
//
// Path 2 — 抖音私信主动触达 handler（thin v1）
//
// 职责：驱动 xian-pc 上已登录抖音的 burner Chrome（CDP / persistent context），
//   进对方主页 → 点「私信」按钮（Semi UI semi-button-second）→ contenteditable 输入文案
//   → 回车发送 → 看消息气泡判定 sent。
//
// 真发由 xian-pc 真机手验，不入自动 E2E（PRD 范围限定）。
// 自动 E2E 走 fake-agent（中台 /dm-outreach-result curl 上报）验编排 + 飞书回写，
//   单测走注入 fake page（DmPage 接口）验 handler 三态判定。
//
// 与 qr-bind-douyin-burner 物理隔离一致：burner profile 用同一 user-data-dir 约定。

import path from 'node:path';
import os from 'node:os';

/** 触达三态：sent=已发出 / limited=仅互关受限 / failed=失败 */
export type DmStatus = 'sent' | 'limited' | 'failed';

export interface DmOutreachPayload {
  profile_url: string;
  message: string;
  account_label: string;
}

export interface DmOutreachResult {
  ok: boolean;
  status: DmStatus;
  account_label?: string;
  profile_url?: string;
  error_code?: string;
  error?: string;
}

/**
 * handler 真正驱动的页面抽象。
 * - 单测注入 fake page（只实现这 6 个方法）。
 * - 真机由 createRealDmPage 把 Playwright page 包成此接口。
 */
export interface DmPage {
  url(): string;
  goto(url: string): Promise<void>;
  /** 点「私信」按钮；返回 false = 按钮不可点（仅互关受限） */
  clickDmButton(): Promise<boolean>;
  typeMessage(text: string): Promise<void>;
  pressEnter(): Promise<void>;
  /** 发送后聊天区是否出现含该文案的消息气泡 */
  hasMessageBubble(text: string): Promise<boolean>;
}

export interface DmOutreachOptions {
  /** 注入页面（单测 / 复用已开浏览器）；不传则真机启 burner Chrome */
  page?: DmPage;
  /** burner profile 根目录覆盖（默认与 qr-bind-burner 一致） */
  userDataDirRoot?: string;
  channel?: string;
  headless?: boolean;
}

/** 触达态 → 飞书 Lead 表「触达状态」中文枚举。limited 绝不写「已私信」（禁止假 sent）。 */
export function mapDmStatusToFeishu(status: DmStatus): string {
  switch (status) {
    case 'sent':
      return '已私信';
    case 'limited':
      return '未送达-仅互关';
    case 'failed':
      return '失败';
    default:
      return '失败';
  }
}

/** burner profile user-data-dir，与 qr-bind-douyin-burner getBurnerUserDataDir 同约定 */
function getBurnerUserDataDir(accountLabel: string, root?: string): string {
  if (root) return path.join(root, accountLabel);
  if (process.platform === 'win32') {
    return path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel);
  }
  return path.join(
    os.homedir(),
    '.zenithjoy-agent',
    'chrome-profile',
    'douyin-burner',
    accountLabel,
  );
}

/**
 * 核心编排：只调用 DmPage 6 个方法，单测 / 真机共用同一判定逻辑。
 *   点私信 → 失败=limited；可点 → 输入 → 回车 → 看气泡 → sent，否则 failed。
 */
export async function handleDouyinDmOutreach(
  payload: DmOutreachPayload,
  options: DmOutreachOptions = {},
): Promise<DmOutreachResult> {
  const { profile_url, message, account_label } = payload;

  if (!profile_url) {
    return { ok: false, status: 'failed', account_label, error_code: 'MISSING_PROFILE_URL', error: 'profile_url 必填' };
  }
  if (!message) {
    return { ok: false, status: 'failed', account_label, profile_url, error_code: 'MISSING_MESSAGE', error: 'message 必填' };
  }

  let page: DmPage;
  try {
    page = options.page ?? (await createRealDmPage(payload, options));
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      account_label,
      profile_url,
      error_code: 'PAGE_LAUNCH_FAILED',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await page.goto(profile_url);

    // 点「私信」按钮；不可点 = 对方仅互关受限 → 如实标 limited（禁止假 sent）
    const canDm = await page.clickDmButton();
    if (!canDm) {
      return { ok: false, status: 'limited', account_label, profile_url };
    }

    await page.typeMessage(message);
    await page.pressEnter();

    // 气泡出现 = 真发出
    const sent = await page.hasMessageBubble(message);
    if (sent) {
      return { ok: true, status: 'sent', account_label, profile_url };
    }
    return { ok: false, status: 'failed', account_label, profile_url, error_code: 'NO_BUBBLE', error: '回车后未见消息气泡' };
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      account_label,
      profile_url,
      error_code: 'SEND_ERROR',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 真机：把已登录 burner Chrome 的 Playwright page 包成 DmPage。
 * 仅 xian-pc 真机手验路径走到这里；CI/单测都注入 fake page，不触达此函数。
 * 选择器对齐抖音 Semi UI：私信按钮 semi-button-second + contenteditable 输入框 + Enter。
 */
async function createRealDmPage(
  payload: DmOutreachPayload,
  options: DmOutreachOptions,
): Promise<DmPage> {
  const moduleName = 'playwright';
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<{ chromium?: unknown }>;
  let playwright: { chromium?: unknown } | null = null;
  try {
    playwright = await dynImport(moduleName);
  } catch {
    playwright = null;
  }
  const chromium = playwright?.chromium as
    | {
        launchPersistentContext(
          dir: string,
          opts?: { channel?: string; headless?: boolean },
        ): Promise<RealContext>;
      }
    | undefined;
  if (!chromium) {
    throw new Error('playwright 未安装；真机需先装 playwright (npm i playwright)');
  }

  const userDataDir = getBurnerUserDataDir(payload.account_label, options.userDataDirRoot);
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: options.channel ?? 'msedge',
    headless: options.headless ?? false,
  });
  const pages = ctx.pages();
  const pwPage: RealPage = pages.length > 0 ? pages[0] : await ctx.newPage();

  // 抖音私信按钮（Semi UI）：href 含 /message 或 button 文本「私信」
  const DM_BUTTON_SELECTORS = [
    'button.semi-button-secondary:has-text("私信")',
    'button:has-text("私信")',
    'a[href*="/message"]',
  ];
  const EDITOR_SELECTOR = 'div[contenteditable="true"]';

  return {
    url: () => pwPage.url(),
    goto: async (url: string) => {
      await pwPage.goto(url, { waitUntil: 'domcontentloaded' });
      // 模拟滑动 + 随机停留，降低风控
      await pwPage.mouse?.wheel?.(0, 600).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1500 + Math.floor(payload.message.length % 5) * 300));
    },
    clickDmButton: async () => {
      for (const sel of DM_BUTTON_SELECTORS) {
        const loc = pwPage.locator(sel).first();
        try {
          if ((await loc.count()) > 0 && (await loc.isEnabled())) {
            await loc.click({ timeout: 5000 });
            return true;
          }
        } catch {
          // 该 selector 不可点，试下一个
        }
      }
      return false; // 没有可点私信按钮 = 仅互关受限
    },
    typeMessage: async (text: string) => {
      const editor = pwPage.locator(EDITOR_SELECTOR).first();
      await editor.click({ timeout: 5000 });
      await editor.fill(text);
    },
    pressEnter: async () => {
      await pwPage.keyboard.press('Enter');
    },
    hasMessageBubble: async (text: string) => {
      try {
        const bubble = pwPage.locator(`text=${text}`).first();
        await bubble.waitFor({ state: 'visible', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ── 真机 Playwright 最小类型（避免硬依赖 playwright 类型；真机才用到）──
interface RealLocator {
  first(): RealLocator;
  count(): Promise<number>;
  isEnabled(): Promise<boolean>;
  click(opts?: { timeout?: number }): Promise<void>;
  fill(text: string): Promise<void>;
  waitFor(opts?: { state?: string; timeout?: number }): Promise<void>;
}
interface RealPage {
  url(): string;
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  locator(sel: string): RealLocator;
  keyboard: { press(key: string): Promise<void> };
  mouse?: { wheel?(x: number, y: number): Promise<void> };
}
interface RealContext {
  pages(): RealPage[];
  newPage(): Promise<RealPage>;
}
