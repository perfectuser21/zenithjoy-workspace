/**
 * Agent Credit 路由 — 积分扣费/查询（Agent 端）
 *
 * 端点：
 *   GET  /api/agent/credit/balance   licenseAuth — 当前 license 对应 tenant 的积分余额
 *   POST /api/agent/credit/deduct    licenseAuth — 扣减积分（body: { amount, reason, metadata? }）
 *
 * 鉴权：x-license-key / Authorization: Bearer <license_key>
 */

import { Router, Request, Response } from 'express';
import { licenseAuth } from '../middleware/license-auth';
import { getBalance, consume, InsufficientCreditsError } from '../services/credits.service';

export const agentCreditRouter = Router();

// ==================== GET /balance ====================

agentCreditRouter.get(
  '/balance',
  licenseAuth,
  async (req: Request, res: Response) => {
    const tenantId = req.license?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({
        ok: false,
        code: 'NO_TENANT',
        message: 'license 未关联租户',
      });
    }

    try {
      const row = await getBalance(tenantId);
      const data = row ?? { balance: 0, total_recharged: 0, total_consumed: 0 };
      return res.json({
        ok: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        ok: false,
        code: 'FETCH_FAILED',
        message: msg,
      });
    }
  }
);

// ==================== POST /deduct ====================

agentCreditRouter.post(
  '/deduct',
  licenseAuth,
  async (req: Request, res: Response) => {
    const tenantId = req.license?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({
        ok: false,
        code: 'NO_TENANT',
        message: 'license 未关联租户',
      });
    }

    const { amount, reason, metadata } = req.body ?? {};

    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > 1_000_000
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_AMOUNT',
        message: 'amount 必须是 1..1000000 的正整数',
      });
    }

    if (
      typeof reason !== 'string' ||
      reason.length === 0 ||
      reason.length > 100
    ) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_REASON',
        message: 'reason 必须是 1..100 字符',
      });
    }

    try {
      const row = await consume(
        tenantId,
        amount,
        reason,
        metadata && typeof metadata === 'object' ? metadata : undefined
      );
      return res.json({
        ok: true,
        data: { tenant_id: tenantId, ...row },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({
          ok: false,
          code: 'INSUFFICIENT_CREDITS',
          message: err.message,
          data: { required: err.required, current: err.current },
        });
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        ok: false,
        code: 'DEDUCT_FAILED',
        message: msg,
      });
    }
  }
);
