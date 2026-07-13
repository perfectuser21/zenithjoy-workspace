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

export type DevQuickVerifyResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number; durationMs: number }
  | { ok: false; rejected: 'not_dev_machine' | 'not_whitelisted' | 'timeout'; durationMs: number };

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
