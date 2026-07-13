// T1 RPA 开发快验通道（agent execFile channel）
// 设计: cecelia docs/architecture/2026-07-13-rpa-target-environment-axis/design.md
// 合同点（Alex 2026-07-13 拍板）:
//   ① 只跑已注册动作（DEV_VERIFY_WHITELIST 红线，绝不接受任意命令）
//   ② 只在研发机（ROG）开，生产机（xian-pc）拒
//   ③ 同步超时默认 60s 可配
//   ④ 仅内网/本机触发（由 index.ts 接线层保证，不在本 handler 职责内）

// 白名单 = 已注册受控动作，扩项需主理人拍板。
// 绝对禁止加入 shell / exec / eval / run_script 类任意命令执行动作。
export const DEV_VERIFY_WHITELIST: ReadonlySet<string> = new Set([
  'health_check',
  'wechat_private_chat_send',
  'wechat_moments_send',
  'wechat_qr_bind',
]);

const DEFAULT_TIMEOUT_MS = 60_000;

export interface DevQuickVerifyMsg {
  type: 'dev_quick_verify';
  payload: { action: string; params: Record<string, unknown> };
}

export interface ActionRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DevQuickVerifyDeps {
  isDevMachine: boolean;
  runAction: (action: string, params: Record<string, unknown>) => Promise<ActionRunResult>;
  timeoutMs?: number;
}

export interface DevQuickVerifyResult {
  ok: boolean;
  rejected?: 'not_dev_machine' | 'not_whitelisted' | 'timeout';
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs: number;
}

export async function handleDevQuickVerify(
  msg: DevQuickVerifyMsg,
  deps: DevQuickVerifyDeps,
): Promise<DevQuickVerifyResult> {
  const start = Date.now();

  // 闸1（机器红线优先）：生产机绝不被快验通道驱动
  if (!deps.isDevMachine) {
    return { ok: false, rejected: 'not_dev_machine', durationMs: Date.now() - start };
  }

  // 闸2：白名单外的 action 绝不执行
  const { action, params } = msg.payload;
  if (!DEV_VERIFY_WHITELIST.has(action)) {
    return { ok: false, rejected: 'not_whitelisted', durationMs: Date.now() - start };
  }

  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });

  try {
    const outcome = await Promise.race([deps.runAction(action, params), timeout]);
    if (outcome === 'timeout') {
      return { ok: false, rejected: 'timeout', durationMs: Date.now() - start };
    }
    return {
      ok: true,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      exitCode: outcome.exitCode,
      durationMs: Date.now() - start,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── 默认接线件（index.ts 使用）────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

// 合同点②:研发机唯一开关。默认 false → 生产机（xian-pc 等）不设即安全拒绝。
export function isDevMachineFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZENITHJOY_DEV_MACHINE === '1';
}

function getPythonExe(): string {
  const embedded = path.join(path.dirname(process.execPath), 'python-embedded/python.exe');
  return fs.existsSync(embedded) ? embedded : 'python3';
}

// 与 wechat-rpa 同款路径约定（pkg 打包后脚本在 exe 同级 wechat-rpa/ 目录）。
// 不 import wechat-rpa.ts —— 该文件已 @deprecated，禁止 core 新代码引用。
function resolveActionScript(action: string): string | null {
  const rpaDir = path.join(path.dirname(process.execPath), 'wechat-rpa');
  switch (action) {
    case 'wechat_private_chat_send': return path.join(rpaDir, 'send_chat.py');
    case 'wechat_moments_send':      return path.join(rpaDir, 'send_moment.py');
    case 'wechat_qr_bind':           return path.join(rpaDir, 'qr_bind.py');
    default:                         return null;
  }
}

// 白名单动作的真实执行体：execFile/spawn 拉起已注册受控脚本，同步回收 stdout/exitCode。
export async function runRegisteredAction(
  action: string,
  params: Record<string, unknown>,
): Promise<ActionRunResult> {
  if (action === 'health_check') {
    return { stdout: JSON.stringify({ ok: true, ts: Date.now() }), stderr: '', exitCode: 0 };
  }
  const script = resolveActionScript(action);
  if (!script) {
    // 白名单闸在 handleDevQuickVerify 已挡住未注册动作；此处兜底防白名单与映射表脱节。
    return { stdout: '', stderr: `no script mapping for action: ${action}`, exitCode: 1 };
  }
  return new Promise((resolve) => {
    const py = spawn(getPythonExe(), [script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    py.stdin.write(JSON.stringify({ type: action, payload: params }) + '\n');
    py.stdin.end();
    py.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    py.on('error', (e) => resolve({ stdout: '', stderr: `spawn fail: ${e.message}`, exitCode: 1 }));
  });
}
