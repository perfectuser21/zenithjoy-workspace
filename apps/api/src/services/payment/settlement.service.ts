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
  | 'order_not_found'
  /**
   * C-2：CAS 未命中，但补读到的当前状态不是 credited——真实原因可能是 expired /
   * amount_mismatch / refund_pending / created 等任何非 pending 状态。此前一律
   * 谎报成 already_credited，会让前端把"钱可能已收但订单无法正常结算，需人工核查"
   * 的场景误判成充值成功。
   */
  | 'not_settlable';

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
      // C-2：CAS 未命中的真实原因不一定是"已入账"（并发回调/重复投递），也可能是
      // expired/amount_mismatch/refund_pending/created 等任何非 pending 前置状态。
      // 在同一事务内、ROLLBACK 之前补读一次当前状态，仅用于返回值分类与日志——
      // CAS 已经完成全部决策，这次补读不参与决策，即使读到瞬时值也不影响正确性。
      const cur = await client.query<{ status: string }>(
        `SELECT status FROM zenithjoy.payment_orders WHERE id = $1`,
        [order.id]
      );
      await client.query('ROLLBACK');
      const currentStatus = cur.rows[0]?.status;

      if (currentStatus === 'credited') {
        return { outcome: 'already_credited', orderId: order.id };
      }

      // C-1：根因场景是支付宝码此前永不过期，商家在本地订单已过期后才扫码付款——
      // 钱可能已经收到，但订单已是终态，任何后续结算都会卡在这里。修好 C-1 的根因
      // （timeout_express）后这条路径应当为零；出现即异常，必须响亮告警要求人工核查。
      console.error(
        '[payment] CAS 未命中且当前状态非 credited，钱可能已收但订单无法正常结算，需人工核查',
        {
          payment_order_id: order.id,
          tenant_id: order.tenant_id,
          out_trade_no: order.out_trade_no,
          provider_transaction_id: q.transactionId,
          current_status: currentStatus,
        }
      );
      return { outcome: 'not_settlable', orderId: order.id };
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

/**
 * I-1：recordCallback 是审计去重闸，排在 settleOrder 之前。首次投递若后续处理
 * （settleOrder / markRefundPending）失败返 5xx，平台重推时 recordCallback 会
 * 命中 UNIQUE 返回 false，路由直接判"重复"返 200——结算被永久跳过。
 * 供路由在"本次是首次插入、后续处理却失败"时删掉本次刚插入的那条审计行，
 * 让平台重推能重新走完整流程。按三元组精确定位，不会误删其它记录。
 */
export async function deleteCallbackRecord(
  provider: string,
  providerTransactionId: string,
  eventType: string
): Promise<void> {
  await pool.query(
    `DELETE FROM zenithjoy.payment_callbacks
      WHERE provider = $1 AND provider_transaction_id = $2 AND event_type = $3`,
    [provider, providerTransactionId, eventType]
  );
}

/**
 * 退款一律落待人工，绝不自动扣回积分（会撞 balance>=0 的 CHECK）。
 *
 * I-3：ALLOWED_TRANSITIONS.refund_pending = ['credited']。退款回调早于入账、
 * 或订单已是 expired 等终态时，UPDATE 影响 0 行——此前函数静默返回，一笔该
 * 人工处理的退款就此消失、零告警。必须检查 rowCount，未命中时响亮告警并让
 * 调用方能感知（返回 false）。
 */
export async function markRefundPending(orderId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE zenithjoy.payment_orders
        SET status = 'refund_pending', updated_at = now()
      WHERE id = $1 AND status = ANY($2)`,
    [orderId, ALLOWED_TRANSITIONS.refund_pending]
  );
  if (r.rowCount !== 1) {
    const cur = await pool.query<{ status: string }>(
      `SELECT status FROM zenithjoy.payment_orders WHERE id = $1`,
      [orderId]
    );
    console.error('[payment] markRefundPending CAS 未命中，该退款需人工核查', {
      payment_order_id: orderId,
      current_status: cur.rows[0]?.status ?? 'not_found',
    });
    return false;
  }
  return true;
}
