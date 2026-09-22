/**
 * 充值订单 —— 商家自助端点（与 super-admin 的 /api/credits/recharge 区分）
 */
import { Router, type Request, type Response } from 'express';
import { tenantContext } from '../middleware/tenant-context';
import { simpleRateLimit } from '../middleware/simple-rate-limit';
import {
  createRechargeOrder,
  InvalidTierError,
} from '../services/payment/orders.service';
import { settleOrder } from '../services/payment/settlement.service';
import { RECHARGE_TIERS } from '../services/payment/types';
import pool from '../db/connection';

export const creditsOrdersRouter = Router();

const ok = (data: unknown) => ({ success: true, data, timestamp: new Date().toISOString() });
const fail = (code: string, message: string) => ({
  success: false, data: null, error: { code, message }, timestamp: new Date().toISOString(),
});

/** 仅 owner / admin 可充值（涉及花钱） */
function requireBillingRole(req: Request, res: Response, next: () => void): void {
  const role = req.tenantRole;
  if (role !== 'owner' && role !== 'admin') {
    res.status(403).json(fail('FORBIDDEN', '仅企业 owner / admin 可发起充值'));
    return;
  }
  next();
}

creditsOrdersRouter.get('/tiers', tenantContext, (_req, res) => {
  res.json(ok({ tiers: RECHARGE_TIERS }));
});

creditsOrdersRouter.post(
  '/',
  tenantContext,
  requireBillingRole,
  simpleRateLimit({ windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    const { tier_id: tierId, provider } = req.body ?? {};
    if (typeof tierId !== 'string' || typeof provider !== 'string') {
      res.status(400).json(fail('INVALID_INPUT', 'tier_id 与 provider 必填'));
      return;
    }
    try {
      const order = await createRechargeOrder(req.tenantId as string, tierId, provider);
      res.json(ok(order));
    } catch (err) {
      if (err instanceof InvalidTierError) {
        res.status(400).json(fail('INVALID_TIER', '未知充值档位'));
        return;
      }
      console.error('[payment] 下单失败', { error: (err as Error).message });
      res.status(502).json(fail('CREATE_ORDER_FAILED', '生成二维码失败，请重试'));
    }
  }
);

/** 商家点「我已支付」→ 主动查单，复用同一结算路径（天然幂等） */
creditsOrdersRouter.post('/:id/sync', tenantContext, async (req: Request, res: Response) => {
  const r = await pool.query<{ out_trade_no: string; provider: string }>(
    `SELECT out_trade_no, provider FROM zenithjoy.payment_orders
      WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.tenantId]
  );
  const row = r.rows[0];
  if (!row) {
    res.status(404).json(fail('ORDER_NOT_FOUND', '订单不存在'));
    return;
  }
  try {
    const result = await settleOrder(row.out_trade_no, row.provider);
    res.json(ok({ outcome: result.outcome }));
  } catch (err) {
    console.error('[payment] 主动查单失败', { error: (err as Error).message });
    res.status(502).json(fail('SYNC_FAILED', '确认中，请稍后刷新'));
  }
});

creditsOrdersRouter.get('/', tenantContext, async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, out_trade_no, provider, amount_fen, credits, status, created_at, credited_at
       FROM zenithjoy.payment_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [req.tenantId]
  );
  res.json(ok({ orders: r.rows }));
});
