/**
 * 结算 —— 回调与主动查单共用的唯一入账路径。
 *
 * 判定点（决策 6afcdcde）：不信回调内容，一律以平台查单结果为准。
 * 幂等：订单状态 CAS（单条 UPDATE ... WHERE status = ANY(...) 自带原子性，
 * rowCount=1 才入账）+ credit_transactions.order_id 唯一索引兜底两道闸，
 * 都与「是否复用同一条连接」无关——同一连接不提供任何跨语句隔离保证，
 * BEGIN 之前每条语句各自 autocommit。
 *
 * 连接只在需要原子性的那一段持有：查订单（pool.query）、查单（provider.queryOrder，
 * 真实网关是跨境 HTTP，秒级甚至可能超时）、标记 amount_mismatch（pool.query 单句
 * 自带原子性）全部不占用池连接；只有 CAS + rechargeInTx 这段要求同一事务同一 client
 * 才 pool.connect() + BEGIN/COMMIT。绝不在持有 DB 连接时做外部网络调用——
 * 回调高峰 + 网关抖动会把每笔在途结算钉住一个池连接，直接耗尽连接池。
 */
import pool from '../../db/connection';
import { rechargeInTx, DuplicateCreditError } from '../credits.service';
import { getProvider } from './provider-registry';
import { ALLOWED_TRANSITIONS } from './types';

export type SettleOutcome =
  | 'credited'
  | 'already_credited'
  | 'not_paid'
  | 'amount_mismatch'
  | 'credit_conflict'
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

  // 1) 查订单：pool.query，不占连接
  const found = await pool.query<OrderRow>(
    `SELECT id, tenant_id, out_trade_no, provider, amount_fen, credits, status FROM zenithjoy.payment_orders
      WHERE provider = $1 AND out_trade_no = $2`,
    [providerName, outTradeNo]
  );
  const order = found.rows[0];
  if (!order) return { outcome: 'order_not_found' };

  // 2) 查单：外部 HTTP，权威状态来自平台查单，不是回调体。此时手里没有任何池连接。
  const q = await provider.queryOrder(outTradeNo);
  if (q.status !== 'success') {
    return { outcome: 'not_paid', orderId: order.id };
  }

  // 3) 金额校验 fail-closed：缺失或不符都不入账，绝不能"拿不到就当它对"。
  //    也不能返回 not_paid ——平台已明说 success，报"没付"是撒谎，还会被兜底
  //    job 反复重查；provider 不返金额通常是确定性的实现特性，重查一万次
  //    还是不返，形成永不收敛的循环。单句 UPDATE 本身自带原子性，不需要事务。
  if (typeof q.amountFen !== 'number' || q.amountFen !== order.amount_fen) {
    const failureReason =
      typeof q.amountFen !== 'number'
        ? `平台查单未返回金额，无法核验（provider=${providerName}）`
        : `平台金额 ${q.amountFen} 与订单 ${order.amount_fen} 不符`;
    await pool.query(
      `UPDATE zenithjoy.payment_orders
          SET status = 'amount_mismatch', failure_reason = $2, updated_at = now()
        WHERE id = $1 AND status = ANY($3)`,
      [order.id, failureReason, ALLOWED_TRANSITIONS.amount_mismatch]
    );
    return { outcome: 'amount_mismatch', orderId: order.id };
  }

  // 4) 只有入账这一段才 connect + BEGIN/COMMIT：CAS 与 rechargeInTx 必须共享
  //    同一事务内的 client，否则「订单状态变更」与「入账」会落到两个独立
  //    事务——入账已提交而订单回滚时，重复回调会再次 CAS 成功并重复加积分。
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query('BEGIN');
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
    releaseErr = err instanceof Error ? err : new Error(String(err));
    // PostgreSQL 事务中一条语句失败后整个事务进入 aborted 态，无法 COMMIT，
    // 必须先 ROLLBACK 才能再发别的语句（包括下面 DuplicateCreditError 分支）。
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // ROLLBACK 自身抛错（比如连接已断）不能顶掉根因，只记录、不覆盖原始异常
      console.error('[payment] ROLLBACK 失败，忽略并向上抛出原始错误', rollbackErr);
    }

    if (err instanceof DuplicateCreditError) {
      // 命中 credit_transactions.order_id 唯一索引：积分已经入过账了，只是这次
      // 事务里订单状态 CAS 没能一起提交，造成账实分叉。用独立语句（走 pool，
      // 而不是已经因异常作废的 client）把订单状态补齐到 credited，让账实对齐，
      // 并把结果当作成功确认返回——重试解决不了账实分叉，只会刷屏。
      const healed = await pool.query(
        `UPDATE zenithjoy.payment_orders
            SET status = 'credited', provider_transaction_id = COALESCE($3, provider_transaction_id), credited_at = COALESCE(credited_at, now()), updated_at = now()
          WHERE id = $1 AND status = ANY($2)`,
        [order.id, ALLOWED_TRANSITIONS.credited, q.transactionId ?? null]
      );
      if (healed.rowCount === 1) {
        console.error('[payment] 账实分叉已自愈：积分已入账，订单状态补齐为 credited', {
          payment_order_id: order.id,
          tenant_id: order.tenant_id,
          out_trade_no: order.out_trade_no,
        });
      } else {
        console.error('[payment] 账实分叉未自愈：积分已入账但订单状态非 pending，需人工核查', {
          payment_order_id: order.id,
          tenant_id: order.tenant_id,
          out_trade_no: order.out_trade_no,
          outcome: 'credit_conflict',
        });
      }
      return { outcome: 'credit_conflict', orderId: order.id };
    }

    // 其他入账错误：向上抛出，调用方据此返回 5xx 让支付平台重试
    throw err;
  } finally {
    // 异常路径带 err 释放：销毁这条可能已经处于坏状态的连接，不放回池子
    client.release(releaseErr);
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
