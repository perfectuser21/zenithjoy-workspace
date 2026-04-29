/**
 * credit-charge 中间件 — PR-C 积分基建
 *
 * 用法：
 *   const charger = createCreditCharger('ai_writing');
 *   app.post('/api/ai-video/...', tenantContext, charger, handler);
 *
 * 行为：
 *   - 从 req.tenantId（tenantContext 中间件挂载）拿 tenant
 *   - 没拿到 → 500 NO_TENANT_CONTEXT（说明上游漏挂 tenantContext）
 *   - 调 consume(tenantId, COSTS[reasonKey], reasonKey)
 *     - 余额够（事务 COMMIT）→ next()
 *     - 余额不够（InsufficientCreditsError）→ 402 + {code: INSUFFICIENT_CREDITS, required, current}
 *     - 其他错误 → 500 CREDITS_INTERNAL_ERROR
 *
 * 注：consume 内部已是单事务，扣减失败会自动 ROLLBACK，本中间件无需处理。
 *
 * 本 PR 不接入业务端点（ai-video / competitor-research 路由不动），业务接入留给后续 PR。
 */
import type { Request, Response, NextFunction } from 'express';
import {
  consume,
  CREDIT_COSTS,
  CreditReasonKey,
  InsufficientCreditsError,
} from '../services/credits.service';

export function createCreditCharger(reasonKey: CreditReasonKey) {
  const cost = CREDIT_COSTS[reasonKey];

  return async function creditCharger(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const tenantId = req.tenantId;
    if (!tenantId || typeof tenantId !== 'string' || tenantId.length === 0) {
      res.status(500).json({
        success: false,
        data: null,
        error: {
          code: 'NO_TENANT_CONTEXT',
          message:
            'credit-charge 中间件要求 req.tenantId 已存在（请在 tenantContext 之后挂载）',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      await consume(tenantId, cost, reasonKey, undefined);
      next();
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        res.status(402).json({
          success: false,
          data: null,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: err.message,
            required: err.required,
            current: err.current,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'unknown';
      res.status(500).json({
        success: false,
        data: null,
        error: { code: 'CREDITS_INTERNAL_ERROR', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
  };
}
