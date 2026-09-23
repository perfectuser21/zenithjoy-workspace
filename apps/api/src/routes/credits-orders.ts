/**
 * 充值订单 —— 商家自助端点（与 super-admin 的 /api/credits/recharge 区分）
 */
import { Router, type Request, type Response } from 'express';
import { tenantContext } from '../middleware/tenant-context';
import { ipKeyFn, simpleRateLimit } from '../middleware/simple-rate-limit';
import {
  createRechargeOrder,
  InvalidTierError,
} from '../services/payment/orders.service';
import { settleOrder } from '../services/payment/settlement.service';
import { RECHARGE_TIERS } from '../services/payment/types';
import pool from '../db/connection';

export const creditsOrdersRouter = Router();

// CodeQL js/missing-rate-limiting + 本文件四条路由的限流统一说明：
//
// 限流中间件必须挂在 tenantContext 之前（每条路由的第一个中间件）——tenantContext
// 自己会查一次 DB（SELECT tenant_members），挂在它之后等于让这次查询永远不受限流
// 保护，CodeQL 的数据流分析能看穿这一点，照样判 high。
//
// 正因为挂在 tenantContext 之前，这时候 req.tenantId 还不存在——用默认的
// tenantKeyFn 会全部回退到同一个 'anonymous' 桶，变成所有租户共用一个全局配额
// （一个租户打满，其他租户全部被连坐 429），所以这里统一改按 IP 限流（ipKeyFn），
// 和 payment-callback 的处理方式一致。
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

// 低风险读操作（返回静态档位表），60 次/分钟/IP 足够。
creditsOrdersRouter.get(
  '/tiers',
  simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }),
  tenantContext,
  (_req, res) => {
    res.json(ok({ tiers: RECHARGE_TIERS }));
  }
);

creditsOrdersRouter.post(
  '/',
  // 10 次/分钟/IP：下单会真的建支付订单（对接支付渠道），比读操作贵，阈值收紧。
  simpleRateLimit({ windowMs: 60_000, max: 10, keyFn: ipKeyFn }),
  tenantContext,
  requireBillingRole,
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
      // 低成本顺手项：getProvider（provider-registry.ts）对未注册的 provider 名
      // 抛 `UNKNOWN_PROVIDER: <name>`，此前落进下面的下单失败兜底返 502——语义
      // 应为 400，客户端传了个系统里压根没有的 provider 名，不是网关/后端故障。
      if (err instanceof Error && err.message.startsWith('UNKNOWN_PROVIDER')) {
        res.status(400).json(fail('UNKNOWN_PROVIDER', '未知支付渠道'));
        return;
      }
      console.error('[payment] 下单失败', { error: (err as Error).message });
      res.status(502).json(fail('CREATE_ORDER_FAILED', '生成二维码失败，请重试'));
    }
  }
);

/** 商家点「我已支付」→ 主动查单，复用同一结算路径（天然幂等） */
creditsOrdersRouter.post(
  '/:id/sync',
  // 60 次/分钟/IP：前端充值页每 5 秒轮询一次（=12 次/分钟）+ 商家手动点「我已支付」，
  // 留足余量避免误伤正常轮询。
  simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }),
  tenantContext,
  async (req: Request, res: Response) => {
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
  }
);

// 60 次/分钟/IP：订单列表也是读操作，与 /tiers 同档。
creditsOrdersRouter.get(
  '/',
  simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }),
  tenantContext,
  async (req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT id, out_trade_no, provider, amount_fen, credits, status, created_at, credited_at
         FROM zenithjoy.payment_orders
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [req.tenantId]
    );
    res.json(ok({ orders: r.rows }));
  }
);
