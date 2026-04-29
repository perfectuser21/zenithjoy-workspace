/**
 * Credits 路由 — PR-C 积分基建
 *
 * 端点：
 *   GET  /api/credits/balance         tenantContext — 当前 tenant 余额
 *   GET  /api/credits/transactions    tenantContext — 当前 tenant 流水（倒序，limit 默认 50，最大 200）
 *   POST /api/credits/recharge        superAdminGuard — 给指定 tenant 充值（跨租户操作）
 *
 * 注：充值端点不挂 tenantContext，因为是跨租户管理操作（super-admin 给 X tenant 充值）。
 */

import { Router, Request, Response } from 'express';
import { tenantContext } from '../middleware/tenant-context';
import { superAdminGuard } from '../middleware/super-admin';
import {
  getBalance,
  recharge,
  listTransactions,
} from '../services/credits.service';

export const creditsRouter = Router();

// UUID 校验（与 admin-license 一致）
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ==================== GET /balance ====================

creditsRouter.get(
  '/balance',
  tenantContext,
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      // 理论上 tenantContext 已拦截，但保险
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'NO_TENANT_CONTEXT', message: 'tenantId 未挂载' },
        timestamp: new Date().toISOString(),
      });
    }
    try {
      const r = await getBalance(tenantId);
      // tenant 还没有 credits 行 → 默认 0/0/0
      const data = r ?? { balance: 0, total_recharged: 0, total_consumed: 0 };
      return res.json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'FETCH_FAILED', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ==================== GET /transactions ====================

creditsRouter.get(
  '/transactions',
  tenantContext,
  async (req: Request, res: Response) => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'NO_TENANT_CONTEXT', message: 'tenantId 未挂载' },
        timestamp: new Date().toISOString(),
      });
    }

    let limit = 50;
    const limitRaw = req.query.limit;
    if (typeof limitRaw === 'string' && limitRaw.length > 0) {
      const parsed = parseInt(limitRaw, 10);
      if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 200) {
        limit = parsed;
      }
    }

    try {
      const transactions = await listTransactions(tenantId, limit);
      return res.json({
        success: true,
        data: { transactions, total: transactions.length },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'FETCH_FAILED', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ==================== POST /recharge（super-admin） ====================

creditsRouter.post(
  '/recharge',
  superAdminGuard,
  async (req: Request, res: Response) => {
    const { tenant_id, amount, reason, metadata } = req.body ?? {};

    if (typeof tenant_id !== 'string' || !UUID_PATTERN.test(tenant_id)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'INVALID_TENANT_ID', message: 'tenant_id 必须是 UUID' },
        timestamp: new Date().toISOString(),
      });
    }

    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > 1_000_000
    ) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_AMOUNT',
          message: 'amount 必须是 1..1000000 的正整数',
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (
      typeof reason !== 'string' ||
      reason.length === 0 ||
      reason.length > 100
    ) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'INVALID_REASON',
          message: 'reason 必须是 1..100 字符',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const r = await recharge(
        tenant_id,
        amount,
        reason,
        metadata && typeof metadata === 'object' ? metadata : undefined
      );
      return res.json({
        success: true,
        data: { tenant_id, ...r },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'RECHARGE_FAILED', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
  }
);
