// services/agent/src/shared/event-reporter.ts
//
// Agent 观测上报 — 把日志/错误/升级进度回传中台（Sprint cp-06261900）
//
// 接 T2 端点 POST ${apiBase}/api/agent/events，x-license-key 鉴权（tenant 由 license 解析）。
// 契约见 observability-contract.md「API 端点 1」与「Agent 侧 B」。
//
// 死规矩：失败必须静默吞（try/catch），绝不抛、绝不崩 agent。观测是旁路，挂了不影响主流程。

export interface EventReporterConfig {
  apiBase: string; // 中台基址，例 https://api.zenithjoy.com
  license: string; // license key → x-license-key 头
  agentId?: string; // 本机 agent_id（随 body 上报）
}

export type EventKind = 'log' | 'upgrade';
export type EventLevel = 'info' | 'warn' | 'error';
export type UpgradePhase =
  | 'download'
  | 'verify'
  | 'extract'
  | 'preflight'
  | 'activate'
  | 'done'
  | 'failed';

export interface AgentEvent {
  kind: EventKind;
  level?: EventLevel; // log 用：info|warn|error
  module?: string; // 关联哪个 line 模块（可空）
  phase?: UpgradePhase | string; // upgrade 阶段（log 可空）
  percent?: number; // upgrade 进度 0-100（log 可空）
  message?: string; // 日志正文 / 错误文本 / 升级摘要
  context?: Record<string, unknown>; // 任意附加
}

/**
 * 上报一条观测事件到中台。失败静默吞（绝不抛/绝不崩 agent）。
 * 无 apiBase 或无 license → 直接跳过（不 fetch）。
 */
export async function reportEvent(cfg: EventReporterConfig, event: AgentEvent): Promise<void> {
  try {
    const apiBase = (cfg.apiBase ?? '').replace(/\/+$/, '');
    if (!apiBase || !cfg.license) return; // 没配置好就静默跳过

    const body: Record<string, unknown> = {
      agent_id: cfg.agentId ?? '',
      kind: event.kind,
    };
    if (event.level !== undefined) body.level = event.level;
    if (event.module !== undefined) body.module = event.module;
    if (event.phase !== undefined) body.phase = event.phase;
    if (event.percent !== undefined) body.percent = event.percent;
    if (event.message !== undefined) body.message = event.message;
    if (event.context !== undefined) body.context = event.context;

    const resp = await fetch(`${apiBase}/api/agent/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-license-key': cfg.license,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      // 非 2xx 也静默吞，只留一行 warn 便于排查，不抛
      const text = await resp.text().catch(() => '');
      console.warn(`[event-reporter] HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    // 网络/序列化任何错误都静默吞，绝不崩 agent
    console.warn(`[event-reporter] 上报失败（已吞）：${(err as Error).message}`);
  }
}
