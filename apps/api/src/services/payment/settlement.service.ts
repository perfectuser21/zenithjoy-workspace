/**
 * 结算 —— 回调与主动查单共用的唯一入账路径。
 *
 * 判定点（决策 6afcdcde）：不信回调内容，一律以平台查单结果为准。
 * 幂等：订单状态 CAS（rowCount=1 才入账）+ credit_transactions.order_id 唯一索引兜底。
 *
 * settleOrder 全程只 pool.connect() 一次，查单前的 SELECT、金额不符的标记、
 * CAS + 入账都走同一个 client：
 *   - 查单结果本身可能滞后（回调乱序/重放），把「读订单现状」与「按结果写状态」
 *     放在同一条连接里，避免连接切换之间订单被并发结算改写导致的readCommitted撕裂。
 *   - CAS 与 rechargeInTx 必须共享同一个事务内 client（见下方入账段注释），
 *     干脆让整个函数只用一个 client，杜绝「哪段用 pool、哪段用 client」的心智负担。
 */
import pool from '../../db/connection';
import { rechargeInTx } from '../credits.service';
import { getProvider } from './provider-registry';
import { ALLOWED_TRANSITIONS } from './types';

export type SettleOutcome =
  | 'credited'
  | 'already_credited'
  | 'not_paid'
  | 'amount_mismatch'
  | 'order_not_found';

export interface SettleResult {
  outcome: SettleOutcome;
  orderId?: string;
}

interface OrderRow {
  id: string;
  tenant_id: string;
  out_trade_no: string;
  provider: string;
  amount_fen: number;
  credits: number;
  status: string;
}

export async function settleOrder(
  outTradeNo: string,
  providerName: string
): Promise<SettleResult> {
  const provider = getProvider(providerName);
  const client = await pool.connect();

  try {
    const found = await client.query<OrderRow>(
      `SELECT id, tenant_id, out_trade_no, provider, amount_fen, credits, status FROM zenithjoy.payment_orders
        WHERE provider = $1 AND out_trade_no = $2`,
      [providerName, outTradeNo]
    );
    const order = found.rows[0];
    if (!order) return { outcome: 'order_not_found' };

    // 权威状态来自平台查单，不是回调体
    const q = await provider.queryOrder(outTradeNo);
    if (q.status !== 'success') {
      return { outcome: 'not_paid', orderId: order.id };
    }

    if (typeof q.amountFen === 'number' && q.amountFen !== order.amount_fen) {
      await client.query(
        `UPDATE zenithjoy.payment_orders
            SET status = $2, failure_reason = $3, updated_at = now()
          WHERE id = $1 AND status = ANY($4)`,
        [
          order.id,
          'amount_mismatch',
          `平台金额 ${q.amountFen} 与订单 ${order.amount_fen} 不符`,
          ALLOWED_TRANSITIONS.amount_mismatch,
        ]
      );
      return { outcome: 'amount_mismatch', orderId: order.id };
    }

    await client.query('BEGIN');
    try {
      const cas = await client.query(
        `UPDATE zenithjoy.payment_orders
            SET status = 'credited',
                provider_transaction_id = COALESCE($2, provider_transaction_id),
                credited_at = now(),
                updated_at = now()
          WHERE id = $1 AND status = ANY($3)
        RETURNING id`,
        [order.id, q.transactionId ?? null, ALLOWED_TRANSITIONS.credited]
      );

      if (cas.rowCount !== 1) {
        // 别人已经处理过这单（并发回调 / 重复投递）：CAS 语句本身就是幂等闸，
        // rowCount!==1 说明前置状态已不是 pending，不入账、直接回滚。
        await client.query('ROLLBACK');
        return { outcome: 'already_credited', orderId: order.id };
      }

      // 必须用 rechargeInTx 而非 recharge：后者自己 connect+BEGIN/COMMIT，
      // 会让「订单状态变更」与「入账」落到两个独立事务——入账已提交而订单回滚时，
      // 重复回调会再次 CAS 成功并重复加积分（两道幂等闸同时失效）。
      await rechargeInTx(
        client,
        order.tenant_id,
        order.credits,
        'recharge',
        {
          order_id: order.id,
          provider: order.provider,
          amount_fen: order.amount_fen,
          out_trade_no: order.out_trade_no,
        },
        order.id
      );

      await client.query('COMMIT');
      return { outcome: 'credited', orderId: order.id };
    } catch (err) {
      // 入账抛错必须 ROLLBACK 并向上抛出，调用方据此返回 5xx 让支付平台重试
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
  }
}

/** 按商户订单号定位订单，供回调路由在记审计前拿到 tenant 归属 */
export async function findOrderByOutTradeNo(
  provider: string,
  outTradeNo: string
): Promise<{ id: string; tenantId: string } | null> {
  const r = await pool.query<{ id: string; tenant_id: string }>(
    `SELECT id, tenant_id FROM zenithjoy.payment_orders
      WHERE provider = $1 AND out_trade_no = $2`,
    [provider, outTradeNo]
  );
  const row = r.rows[0];
  return row ? { id: row.id, tenantId: row.tenant_id } : null;
}

/**
 * 记录回调投递；返回 true 表示首次（ON CONFLICT DO NOTHING 判定，非先查后写）
 *
 * tenantId / orderId 可为 null：伪造或乱序的回调可能对不上任何订单，
 * 这类回调仍要留审计痕迹，故两列可空。
 */
export async function recordCallback(
  provider: string,
  providerTransactionId: string,
  eventType: string,
  rawDigest: string,
  orderId: string | null,
  tenantId: string | null
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO zenithjoy.payment_callbacks
       (provider, provider_transaction_id, event_type, order_id, tenant_id, raw_digest)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_transaction_id, event_type) DO NOTHING
     RETURNING id`,
    [provider, providerTransactionId, eventType, orderId, tenantId, rawDigest]
  );
  return r.rowCount === 1;
}

/** 退款一律落待人工，绝不自动扣回积分（会撞 balance>=0 的 CHECK） */
export async function markRefundPending(orderId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.payment_orders
        SET status = 'refund_pending', updated_at = now()
      WHERE id = $1 AND status = ANY($2)`,
    [orderId, ALLOWED_TRANSITIONS.refund_pending]
  );
}
