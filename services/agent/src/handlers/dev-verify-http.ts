// T1 快验通道 HTTP 层 — Brain(POST /api/agent-ops/rpa/dev-verify) → Agent 接缝
// 设计: cecelia docs/architecture/2026-07-13-rpa-target-environment-axis/design.md §3.1
// 合同点④(仅内网/本机触发)在这层 enforce;白名单/研发机闸/超时复用 handleDevQuickVerify。

import {
  handleDevQuickVerify,
  isDevMachineFromEnv,
  runRegisteredAction,
  type DevQuickVerifyDeps,
} from './dev-quick-verify';

const MAX_TIMEOUT_MS = 60_000;

// 内网闸:loopback / RFC1918 / Tailscale CGNAT(100.64/10)。公网一律拒。
export function isInternalAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const ip = addr.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  const m100 = ip.match(/^100\.(\d+)\./);
  if (m100 && Number(m100[1]) >= 64 && Number(m100[1]) <= 127) return true;
  return false;
}

export interface DevVerifyHttpBody {
  line?: string;
  action: string;
  params?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface DevVerifyHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export async function handleDevVerifyHttp(
  reqBody: DevVerifyHttpBody,
  remoteAddr: string | undefined,
  deps?: Partial<DevQuickVerifyDeps>,
): Promise<DevVerifyHttpResult> {
  if (!isInternalAddress(remoteAddr)) {
    return { status: 403, body: { ok: false, error: 'external_source_forbidden' } };
  }

  const appliedTimeoutMs = Math.min(
    typeof reqBody.timeout_ms === 'number' && reqBody.timeout_ms > 0 ? reqBody.timeout_ms : MAX_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );

  const result = await handleDevQuickVerify(
    { type: 'dev_quick_verify', payload: { action: reqBody.action ?? '', params: reqBody.params ?? {} } },
    {
      isDevMachine: deps?.isDevMachine ?? isDevMachineFromEnv(),
      runAction: deps?.runAction ?? runRegisteredAction,
      timeoutMs: appliedTimeoutMs,
    },
  );

  if (!result.ok) {
    const status =
      result.rejected === 'timeout' ? 504 :
      result.rejected === 'not_whitelisted' ? 400 : 403;
    return { status, body: { ok: false, rejected: result.rejected, elapsed_ms: result.durationMs } };
  }

  // 设计稿 §3.1 响应契约:exit_code / elapsed_ms(蛇形),不外泄内部命名
  return {
    status: 200,
    body: {
      ok: true,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      elapsed_ms: result.durationMs,
      applied_timeout_ms: appliedTimeoutMs,
    },
  };
}
