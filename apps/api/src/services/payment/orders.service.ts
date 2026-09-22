/**
 * 充值订单 —— 建单 / 复用活跃单 / 过期兜底
 *
 * 金额与积分数一律由服务端档位表决定，绝不采信客户端传值。
 * 过期兜底必须「先查单再标过期」：回调在过期边界丢失是已知场景，
 * 直接标过期会把已付款订单判死，商家钱付了没到账。
 */
import { randomUUID } from 'crypto';
import pool from '../../db/connection';
import { getProvider } from './provider-registry';
import { settleOrder } from './settlement.service';
import { ALLOWED_TRANSITIONS, ORDER_TTL_MS, findTier } from './types';

export class InvalidTierError extends Error {
  constructor(tierId: string) {
    super(`INVALID_TIER: ${tierId}`);
    this.name = 'InvalidTierError';
  }
}

export interface CreatedOrder {
  orderId: string;
  qrCodeUrl: string;
  expireAt: Date;
  amountFen: number;
  credits: number;
}

export async function createRechargeOrder(
  tenantId: string,
  tierId: string,
  providerName: string
): Promise<CreatedOrder> {
  const tier = findTier(tierId);
  if (!tier) throw new InvalidTierError(tierId);

  const provider = getProvider(providerName);

  // 复用未过期的同档位 pending 单：防连点 / 多 tab 重复下单
  const reuse = await pool.query<{
    id: string; out_trade_no: string; qr_code_url: string;
    expire_at: Date; amount_fen: number; credits: number;
  }>(
    `SELECT id, out_trade_no, qr_code_url, expire_at, amount_fen, credits
       FROM zenithjoy.payment_orders
      WHERE tenant_id = $1 AND provider = $2 AND amount_fen = $3
        AND status = 'pending' AND expire_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, providerName, tier.amountFen]
  );
  const old = reuse.rows[0];
  if (old && old.qr_code_url) {
    return {
      orderId: old.id,
      qrCodeUrl: old.qr_code_url,
      expireAt: old.expire_at,
      amountFen: old.amount_fen,
      credits: old.credits,
    };
  }

  const outTradeNo = `ZJ${Date.now()}${randomUUID().slice(0, 8)}`;
  const expireAt = new Date(Date.now() + ORDER_TTL_MS);

  const created = await pool.query<{ id: string; out_trade_no: string }>(
    `INSERT INTO zenithjoy.payment_orders
       (tenant_id, out_trade_no, provider, amount_fen, credits, status, expire_at)
     VALUES ($1, $2, $3, $4, $5, 'created', $6)
     RETURNING id, out_trade_no`,
    [tenantId, outTradeNo, providerName, tier.amountFen, tier.credits, expireAt]
  );
  const orderId = created.rows[0].id;
  // 以 INSERT RETURNING 回填的 out_trade_no 为准，不信本地生成变量：
  // 和 orderId 取自 DB 返回同一原则——落库值才是唯一真相，本地变量只是入参。
  const persistedOutTradeNo = created.rows[0].out_trade_no;

  let qrCodeUrl: string;
  try {
    const r = await provider.createOrder({
      outTradeNo: persistedOutTradeNo,
      amountFen: tier.amountFen,
      description: `积分充值 ${tier.credits}`,
      expireAt,
    });
    qrCodeUrl = r.qrCodeUrl;
  } catch (err) {
    await pool.query(
      `UPDATE zenithjoy.payment_orders
          SET status = 'create_failed', failure_reason = $2, updated_at = now()
        WHERE id = $1 AND status = ANY($3)`,
      [orderId, (err as Error).message.slice(0, 200), ALLOWED_TRANSITIONS.create_failed]
    );
    throw err;
  }

  await pool.query(
    `UPDATE zenithjoy.payment_orders
        SET status = 'pending', qr_code_url = $2, updated_at = now()
      WHERE id = $1 AND status = ANY($3)`,
    [orderId, qrCodeUrl, ALLOWED_TRANSITIONS.pending]
  );

  return { orderId, qrCodeUrl, expireAt, amountFen: tier.amountFen, credits: tier.credits };
}

export async function expireStaleOrders(): Promise<{
  scanned: number; credited: number; expired: number;
}> {
  const stale = await pool.query<{ id: string; out_trade_no: string; provider: string }>(
    `SELECT id, out_trade_no, provider
       FROM zenithjoy.payment_orders
      WHERE status = 'pending' AND expire_at < now()
      LIMIT 200`
  );

  let credited = 0;
  let expired = 0;

  for (const o of stale.rows) {
    try {
      // 先查单：回调可能在过期边界丢失
      const r = await settleOrder(o.out_trade_no, o.provider);
      // credited / already_credited / credit_conflict 三者都意味着积分确已入账，
      // 绝不能再标过期（credit_conflict = 账实分叉，积分已入、状态刚补齐或待人工）
      if (
        r.outcome === 'credited' ||
        r.outcome === 'already_credited' ||
        r.outcome === 'credit_conflict'
      ) {
        credited += 1;
        continue;
      }
      // 已落待人工的终态，不该被过期覆盖
      if (r.outcome === 'amount_mismatch') continue;

      const upd = await pool.query(
        `UPDATE zenithjoy.payment_orders
            SET status = 'expired', updated_at = now()
          WHERE id = $1 AND status = ANY($2)`,
        [o.id, ALLOWED_TRANSITIONS.expired]
      );
      if (upd.rowCount === 1) expired += 1;
    } catch (err) {
      // 单个订单失败不影响其余；留在 pending 下轮再扫
      console.error('[payment] expireStaleOrders 单单失败', {
        payment_order_id: o.id,
        error: (err as Error).message,
      });
    }
  }

  return { scanned: stale.rows.length, credited, expired };
}
