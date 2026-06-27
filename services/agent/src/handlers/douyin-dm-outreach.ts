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
import fs from 'node:fs';
import { spawn } from 'node:child_process';

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
 * - 真机路径由外部 .cjs 独立进程承担（spawn 生产路径）。
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

  // 生产路径：无注入 page → spawn 外部 .cjs（完整三态编排在 .cjs 内，绕 pkg+playwright 崩溃）。
  // 测试路径：注入 page → 走下方内部三态编排（保旧单测绿）。
  if (!options.page) {
    return spawnDmOutreachProcess(payload, options);
  }
  const page: DmPage = options.page;

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

// 解析外部脚本路径（与 qr-bind-douyin-burner resolveBurnerScript 同款查找）
export function resolveDmOutreachScript(): string {
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'douyin-dm-outreach.cjs');
  if (fs.existsSync(beside)) return beside;
  return path.resolve(__dirname, '..', '..', 'publishers', 'douyin-dm-outreach.cjs');
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

// 生产路径：spawn 外部 Node 进程跑 .cjs，读末行 JSON 当结果。
function spawnDmOutreachProcess(
  payload: DmOutreachPayload,
  options: DmOutreachOptions,
): Promise<DmOutreachResult> {
  const scriptPath = resolveDmOutreachScript();
  const nodeExe = resolveNodeExe();
  const args = [scriptPath, payload.profile_url, payload.message, payload.account_label, options.userDataDirRoot ?? ''];

  return new Promise<DmOutreachResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, args, { env: { ...process.env }, timeout: 60000 });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { console.log('[douyin-dm-outreach]', d.toString().trimEnd()); });
    proc.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as DmOutreachResult);
      } catch {
        resolve({ ok: false, status: 'failed', account_label: payload.account_label, profile_url: payload.profile_url, error_code: 'SPAWN_PARSE_FAILED', error: `result parse failed: ${lastLine || '(no output)'}` });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({ ok: false, status: 'failed', account_label: payload.account_label, profile_url: payload.profile_url, error_code: 'SPAWN_FAILED', error: `spawn failed: ${err.message}` });
    });
  });
}
