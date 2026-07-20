/**
 * Agent 离线静默告警（进程守护）。
 *
 * 每分钟扫描 zenithjoy.agents 中 platform='windows' AND status='online' 且
 * updated_at < NOW() - INTERVAL '${threshold}h' 的行；
 * 超阈值 → 发飞书告警（FEISHU_ALERT_WEBHOOK），进程内 Map 去重（同机只告警一次）。
 * 恢复（updated_at 刷新到阈值内）→ 从 Map 删除，发恢复通知。
 *
 * thin 设计（PR #sprint-07201705）：
 *   - 进程内 Map，多实例场景重启后重新告警一次（可接受）。
 *   - 无 webhook 时仅打 info 日志，不 throw。
 *   - webhook 发送失败必须 throw（INV-01），不静默吞错。
 *
 * 合同: sprints/07201705-agent-offline-alert/contract-draft.md
 * task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
 */

import pool from '../db';

// ─────────────────────────────────────────────────────────────────────────────
// 公开类型
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentOfflineAlert {
  agent_id: string;
  hostname: string;
  offline_duration_minutes: number;
}

export interface ScanResult {
  scanned: number;
  alerted: AgentOfflineAlert[];
  recovered: AgentOfflineAlert[];
  send_errors?: SendError[];
}

export interface SendError {
  agent_id: string;
  hostname: string;
  error: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 进程内去重 Map：agent_id → 首次告警时间
// ─────────────────────────────────────────────────────────────────────────────

const alertedAt = new Map<string, Date>();

/** 测试用：重置去重 Map。 */
export function _resetAlertedMap(): void {
  alertedAt.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 告警发送（INV-01：失败必须 throw）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 发送离线告警到飞书。
 * - 未设 FEISHU_ALERT_WEBHOOK 时：仅打 console.info，不 throw。
 * - 发送失败：打 console.error 并 throw（INV-01）。
 */
export async function sendOfflineAlert(
  agent: AgentOfflineAlert,
  webhookOverride?: string,
): Promise<void> {
  const webhook = webhookOverride ?? process.env.FEISHU_ALERT_WEBHOOK;
  if (!webhook) {
    console.info(
      `[agent-offline-monitor] 未配置 FEISHU_ALERT_WEBHOOK，跳过告警：${agent.hostname}(${agent.agent_id}) 已离线 ${agent.offline_duration_minutes} 分钟`,
    );
    return;
  }

  const thresholdHours = Number(process.env.AGENT_OFFLINE_THRESHOLD_HOURS ?? 4);
  const text =
    `[ZenithJoy Agent 离线告警] hostname=${agent.hostname} agent_id=${agent.agent_id}` +
    ` 已离线 ${Math.floor(agent.offline_duration_minutes)} 分钟（阈值 ${thresholdHours}h）`;

  const body = JSON.stringify({
    msg_type: 'text',
    content: { text },
  });

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    console.error('[agent-offline-monitor] 飞书告警发送失败:', err);
    throw err;
  }
}

/**
 * 发送恢复通知到飞书。
 * - 未设 webhook 时：仅打 info，不 throw。
 * - 发送失败：打 console.error 并 throw（INV-01）。
 */
export async function sendRecoveryAlert(
  agent: AgentOfflineAlert,
  webhookOverride?: string,
): Promise<void> {
  const webhook = webhookOverride ?? process.env.FEISHU_ALERT_WEBHOOK;
  if (!webhook) {
    console.info(
      `[agent-offline-monitor] 未配置 FEISHU_ALERT_WEBHOOK，跳过恢复通知：${agent.hostname}(${agent.agent_id}) 已恢复`,
    );
    return;
  }

  const text =
    `[ZenithJoy Agent 已恢复] hostname=${agent.hostname} agent_id=${agent.agent_id}` +
    ` 已恢复在线（此前离线约 ${Math.floor(agent.offline_duration_minutes)} 分钟）`;

  const body = JSON.stringify({
    msg_type: 'text',
    content: { text },
  });

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    console.error('[agent-offline-monitor] 飞书恢复通知发送失败:', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 扫描核心逻辑
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 扫描离线 Agent 并按需告警。
 *
 * @param opts.thresholdHours - 离线阈值（小时），默认读 AGENT_OFFLINE_THRESHOLD_HOURS（默认 4）
 * @param opts.webhookOverride - 覆盖 webhook URL（smoke / 测试用）
 * @returns { scanned, alerted, recovered, send_errors? }
 */
export async function scanAndAlert(opts?: {
  thresholdHours?: number;
  webhookOverride?: string;
}): Promise<ScanResult> {
  const thresholdHours =
    opts?.thresholdHours ??
    Number(process.env.AGENT_OFFLINE_THRESHOLD_HOURS ?? 4);
  const webhookOverride = opts?.webhookOverride;

  // ── 1. 查询所有 online 且心跳超阈值的 Windows Agent ──────────────────────
  const staleResult = await pool.query<{
    agent_id: string;
    hostname: string;
    offline_duration_minutes: number;
  }>(
    `SELECT agent_id, hostname,
            FLOOR(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60)::int AS offline_duration_minutes
       FROM zenithjoy.agents
      WHERE platform = 'windows'
        AND status = 'online'
        AND updated_at < NOW() - ($1 || ' hours')::interval
      ORDER BY updated_at ASC`,
    [String(thresholdHours)],
  );

  const staleAgents = staleResult.rows;

  // ── 2. 查询之前已经告警、现在已恢复的 Agent（在线：updated_at >= 阈值内）──
  const recoveredList: AgentOfflineAlert[] = [];
  const toRecover: string[] = [];
  for (const [agentId] of alertedAt.entries()) {
    // 检查该 agent_id 是否仍在 stale 列表中
    const stillStale = staleAgents.some((a) => a.agent_id === agentId);
    if (!stillStale) {
      toRecover.push(agentId);
    }
  }

  // ── 3. 发送恢复通知 ───────────────────────────────────────────────────────
  for (const agentId of toRecover) {
    alertedAt.delete(agentId);
    // 查出 hostname
    const rec = await pool.query<{ agent_id: string; hostname: string }>(
      `SELECT agent_id, hostname FROM zenithjoy.agents WHERE agent_id = $1 LIMIT 1`,
      [agentId],
    );
    const row = rec.rows[0];
    if (!row) continue;

    const recovered: AgentOfflineAlert = {
      agent_id: row.agent_id,
      hostname: row.hostname,
      offline_duration_minutes: 0,
    };
    recoveredList.push(recovered);

    try {
      await sendRecoveryAlert(recovered, webhookOverride);
    } catch {
      // 恢复通知失败：日志已在 sendRecoveryAlert 中打印，此处不影响主流程
    }
  }

  // ── 4. 新告警：超阈值且未在去重 Map 中 ──────────────────────────────────
  const alerted: AgentOfflineAlert[] = [];
  const sendErrors: SendError[] = [];

  for (const agent of staleAgents) {
    if (alertedAt.has(agent.agent_id)) {
      // 已告警过，去重跳过
      continue;
    }

    const entry: AgentOfflineAlert = {
      agent_id: agent.agent_id,
      hostname: agent.hostname,
      offline_duration_minutes: Math.floor(agent.offline_duration_minutes),
    };

    try {
      await sendOfflineAlert(entry, webhookOverride);
      // 告警成功 → 写入去重 Map
      alertedAt.set(agent.agent_id, new Date());
      alerted.push(entry);
    } catch (err) {
      // INV-01：sendOfflineAlert 失败会 throw；这里捕获后放入 send_errors，
      // 确保响应中可观测（不静默吞错），同时让其他 agent 的告警继续执行。
      sendErrors.push({
        agent_id: agent.agent_id,
        hostname: agent.hostname,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result: ScanResult = {
    scanned: staleAgents.length,
    alerted,
    recovered: recoveredList,
  };

  if (sendErrors.length > 0) {
    result.send_errors = sendErrors;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// setInterval 守护（同 startStaleListenerMonitor 模式）
// ─────────────────────────────────────────────────────────────────────────────

let monitorTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 生产启动时调用：每 intervalMs 扫描一次离线 Agent 并发告警。重复调用幂等。
 */
export function startAgentOfflineMonitor(
  intervalMs: number = Number(process.env.AGENT_SCAN_INTERVAL_MS ?? 60_000),
): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void scanAndAlert().catch((err) => {
      console.error('[agent-offline-monitor] scanAndAlert 异常:', err);
    });
  }, intervalMs);
  // 不阻止进程退出（同 wechat-heartbeat.ts 模式）
  (monitorTimer as { unref?: () => void }).unref?.();
}

export function stopAgentOfflineMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
