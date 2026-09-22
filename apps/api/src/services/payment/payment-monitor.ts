/**
 * 支付兜底巡检 —— 定时扫过期 pending 订单（先查单再判过期），并监控积压水位。
 *
 * 没有这个调度器，回调一旦丢失订单会永远卡在 pending：商家钱付了、积分不到账。
 * 模式照 services/agent-offline-monitor.ts：模块级 timer、重复调用幂等、
 * unref() 不阻止进程退出、异常只记日志不抛；积压告警发飞书（FEISHU_ALERT_WEBHOOK）
 * 同样照抄该文件的写法：未配置 webhook 时降级为 console.info 且不 throw。
 */
import pool from '../../db/connection';
import { expireStaleOrders } from './orders.service';

/** 积压告警阈值（与设计文档告警表一致：pending > 50 笔，或最老一笔 > 2 小时 → P1 飞书） */
const BACKLOG_COUNT_THRESHOLD = 50;
const BACKLOG_AGE_MS_THRESHOLD = 2 * 60 * 60 * 1000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;

export interface BacklogResult {
  total: number;
  oldestAgeMs: number | null;
  alerted: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 飞书告警去重：积压是持续状态而非离散事件，进入告警态发一次并记录，
// 恢复正常后清除记录，下次再进入告警态才会重新发送（同 agent-offline-monitor.ts 的
// alertedAt Map 思路；本场景是全局状态，不按订单，用固定 key）。
// ─────────────────────────────────────────────────────────────────────────────
const BACKLOG_ALERT_KEY = 'pending-backlog';
const backlogAlerted = new Map<string, boolean>();

/** 测试用：重置去重状态。 */
export function _resetBacklogAlertState(): void {
  backlogAlerted.clear();
}

/**
 * 发送积压告警到飞书。
 * - 未设 FEISHU_ALERT_WEBHOOK 时：仅打 console.info，不 throw。
 * - 发送失败：打 console.error 并 throw（交给调用方决定是否影响去重状态）。
 */
async function sendBacklogAlert(payload: {
  total: number;
  oldestAgeMs: number | null;
  reasons: string[];
}): Promise<void> {
  const oldestMinutes = payload.oldestAgeMs == null ? null : Math.floor(payload.oldestAgeMs / 60000);
  const text =
    `[ZenithJoy 支付积压告警] pending 订单 ${payload.total} 笔，` +
    `最老一笔积压 ${oldestMinutes ?? '未知'} 分钟（触发：${payload.reasons.join('；')}）`;

  const webhook = process.env.FEISHU_ALERT_WEBHOOK;
  if (!webhook) {
    console.info('[payment-monitor] 未配置 FEISHU_ALERT_WEBHOOK，跳过积压告警:', text);
    return;
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
    });
  } catch (err) {
    console.error('[payment-monitor] 飞书积压告警发送失败:', err);
    throw err;
  }
}

/**
 * 扫描当前 pending 积压水位：笔数 > 50 或最老一笔 pending 超 2 小时 → 告警。
 * 告警既打结构化 console.error（便于日志检索），也发飞书（进程内去重，避免刷屏）。
 * 飞书发送失败不会向上抛出，不影响巡检主流程；同时不清去重记录，下次巡检会重试。
 */
export async function scanPendingBacklog(): Promise<BacklogResult> {
  const r = await pool.query<{ total: string; oldest_age_ms: string | null }>(
    `SELECT count(*)::text AS total,
            (EXTRACT(EPOCH FROM (now() - min(created_at))) * 1000)::bigint::text AS oldest_age_ms
       FROM zenithjoy.payment_orders
      WHERE status = 'pending'`
  );
  const row = r.rows[0];
  const total = Number(row?.total ?? 0);
  const oldestAgeMs = row?.oldest_age_ms == null ? null : Number(row.oldest_age_ms);

  const overCount = total > BACKLOG_COUNT_THRESHOLD;
  const overAge = oldestAgeMs !== null && oldestAgeMs > BACKLOG_AGE_MS_THRESHOLD;
  const alerted = overCount || overAge;

  if (alerted) {
    console.error('[payment-monitor] pending 订单积压告警', {
      total,
      oldest_age_ms: oldestAgeMs,
      count_threshold: BACKLOG_COUNT_THRESHOLD,
      age_threshold_ms: BACKLOG_AGE_MS_THRESHOLD,
    });

    if (!backlogAlerted.get(BACKLOG_ALERT_KEY)) {
      const reasons: string[] = [];
      if (overCount) reasons.push(`pending 笔数 ${total} > ${BACKLOG_COUNT_THRESHOLD}`);
      if (overAge) {
        reasons.push(
          `最老订单积压 ${Math.floor((oldestAgeMs as number) / 60000)} 分钟 > ${BACKLOG_AGE_MS_THRESHOLD / 60000} 分钟`
        );
      }
      try {
        await sendBacklogAlert({ total, oldestAgeMs, reasons });
        backlogAlerted.set(BACKLOG_ALERT_KEY, true);
      } catch {
        // 发送失败：sendBacklogAlert 已打印日志，这里吞掉不影响巡检主流程，
        // 且不写入去重记录，下次巡检会重试发送。
      }
    }
  } else {
    backlogAlerted.delete(BACKLOG_ALERT_KEY);
  }

  return { total, oldestAgeMs, alerted };
}

async function tick(): Promise<void> {
  const r = await expireStaleOrders();
  if (r.scanned > 0) {
    console.info('[payment-monitor] 过期兜底完成', r);
  }
  await scanPendingBacklog();
}

/**
 * 生产启动时调用：每 intervalMs 跑一次过期兜底 + 积压水位扫描。重复调用幂等。
 */
export function startPaymentMonitor(
  intervalMs: number = Number(process.env.PAYMENT_SCAN_INTERVAL_MS ?? 5 * 60_000)
): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void tick().catch((err) => {
      console.error('[payment-monitor] tick 异常:', (err as Error).message);
    });
  }, intervalMs);
  // 不阻止进程退出（同 agent-offline-monitor.ts 模式）
  (monitorTimer as { unref?: () => void }).unref?.();
}

export function stopPaymentMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
