/**
 * 支付兜底巡检 —— 定时扫过期 pending 订单（先查单再判过期），并监控积压水位。
 *
 * 没有这个调度器，回调一旦丢失订单会永远卡在 pending：商家钱付了、积分不到账。
 * 模式照 services/agent-offline-monitor.ts：模块级 timer、重复调用幂等、
 * unref() 不阻止进程退出、异常只记日志不抛。
 */
import pool from '../../db/connection';
import { expireStaleOrders } from './orders.service';

/** 积压告警阈值（与设计文档告警表一致） */
const BACKLOG_COUNT_THRESHOLD = 50;
const BACKLOG_AGE_MS_THRESHOLD = 2 * 60 * 60 * 1000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;

export interface BacklogResult {
  total: number;
  oldestAgeMs: number | null;
  alerted: boolean;
}

/**
 * 扫描当前 pending 积压水位：笔数 > 50 或最老一笔 pending 超 2 小时 → 告警。
 * 告警只打结构化 console.error（不含私钥/回调 body/openid），便于日志检索。
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

  const alerted =
    total > BACKLOG_COUNT_THRESHOLD ||
    (oldestAgeMs !== null && oldestAgeMs > BACKLOG_AGE_MS_THRESHOLD);

  if (alerted) {
    console.error('[payment-monitor] pending 订单积压告警', {
      total,
      oldest_age_ms: oldestAgeMs,
      count_threshold: BACKLOG_COUNT_THRESHOLD,
      age_threshold_ms: BACKLOG_AGE_MS_THRESHOLD,
    });
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
