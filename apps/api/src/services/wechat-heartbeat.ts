/**
 * 微信监听心跳记录 + 断线告警（进程守护）。
 *
 * listen_chat.py 每分钟 POST /api/wechat/listener-heartbeat 上报；中台记最后心跳时间。
 * 监听断 3 分钟无心跳 → 飞书告警（FEISHU_ALERT_WEBHOOK），运营第一时间介入。
 *
 * thin：状态存进程内存 Map（单实例中台够用）；加厚阶段可落 DB / Redis 支持多实例。
 */

/** 监听上报的扫描诊断（让运营在中台一眼定位客户监听卡在哪，无需远程进客户桌面）。 */
export interface ListenerDiag {
  main_window_found?: boolean; // 微信主窗口找到没（false = 未找到/未登录）
  login_present?: boolean; // 是否检测到登录窗口（需扫码）
  sessions_seen?: number; // 会话列表项数量
  unread_count?: number; // 本轮扫到的未读会话数
  unread_senders?: string[]; // 未读会话的发信人
  replied_count?: number; // 累计已自动回复条数
  last_error?: string | null; // 最近一次错误（无则 null）
}

export interface HeartbeatInput {
  agent_id?: string;
  wechat_id?: string;
  ts?: number;
  diag?: ListenerDiag;
}

export interface HeartbeatRecord {
  agent_id?: string;
  wechat_id?: string;
  /** 服务端记录到的最后心跳时间（ms epoch）。 */
  ts: number;
  diag?: ListenerDiag;
}

/** 监听断线阈值：3 分钟无心跳即视为掉线。 */
export const STALE_THRESHOLD_MS = 3 * 60 * 1000;

const heartbeats = new Map<string, HeartbeatRecord>();

export function heartbeatKey(input: Pick<HeartbeatInput, 'agent_id' | 'wechat_id'>): string {
  return `${input.agent_id ?? 'unknown'}:${input.wechat_id ?? 'unknown'}`;
}

/** 记录一次心跳。ts 缺省用服务端 now（不信任客户端钟）。 */
export function recordHeartbeat(input: HeartbeatInput, now: number = Date.now()): HeartbeatRecord {
  const rec: HeartbeatRecord = {
    agent_id: input.agent_id,
    wechat_id: input.wechat_id,
    ts: now,
    ...(input.diag ? { diag: input.diag } : {}),
  };
  heartbeats.set(heartbeatKey(input), rec);
  return rec;
}

export function getHeartbeat(
  input: Pick<HeartbeatInput, 'agent_id' | 'wechat_id'>,
): HeartbeatRecord | undefined {
  return heartbeats.get(heartbeatKey(input));
}

export function listHeartbeats(): HeartbeatRecord[] {
  return [...heartbeats.values()];
}

/** 找出超阈值无心跳的监听。 */
export function findStaleListeners(
  now: number = Date.now(),
  thresholdMs: number = STALE_THRESHOLD_MS,
): HeartbeatRecord[] {
  return [...heartbeats.values()].filter((r) => now - r.ts > thresholdMs);
}

/**
 * 检查断线并告警。有断线且配了 FEISHU_ALERT_WEBHOOK → POST 飞书文本告警。
 * 未配 webhook 时仅 log（alerted=false）；发送失败也吞掉不抛（守护不能反噬主流程）。
 */
export async function checkStaleListenersAndAlert(
  now: number = Date.now(),
  thresholdMs: number = STALE_THRESHOLD_MS,
): Promise<{ stale: HeartbeatRecord[]; alerted: boolean }> {
  const stale = findStaleListeners(now, thresholdMs);
  if (stale.length === 0) return { stale, alerted: false };

  const mins = Math.round(thresholdMs / 60000);
  const targets = stale.map((s) => heartbeatKey(s)).join(', ');
  const text = `[ZenithJoy 微信监听告警] ${stale.length} 个监听断线超 ${mins} 分钟无心跳：${targets}`;
  console.warn('[wechat-heartbeat]', text);

  const webhook = process.env.FEISHU_ALERT_WEBHOOK;
  if (!webhook) return { stale, alerted: false };

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });
    return { stale, alerted: true };
  } catch (err) {
    console.warn('[wechat-heartbeat] 飞书告警发送失败:', err);
    return { stale, alerted: false };
  }
}

let monitorTimer: ReturnType<typeof setInterval> | null = null;

/** 生产启动时调用：每 intervalMs 检查一次断线并告警。重复调用幂等。 */
export function startStaleListenerMonitor(intervalMs: number = 60_000): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void checkStaleListenersAndAlert();
  }, intervalMs);
  // 不阻止进程退出
  (monitorTimer as { unref?: () => void }).unref?.();
}

export function stopStaleListenerMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

/** 测试用：清空内存状态。 */
export function _resetHeartbeats(): void {
  heartbeats.clear();
}
