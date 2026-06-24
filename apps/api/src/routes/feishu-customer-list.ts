/**
 * Line04 微信智能客服 — 飞书「客户列表」表 + 飞书→本地单向同步路由（S5 第一刀）
 *
 * 端点（挂在 /api/feishu/customer-list）：
 *   POST /provision  body { tenant_id }                       → 建飞书「客户列表」表（幂等）
 *   POST /sync       body { tenant_id, inject_error?, mock_records? } → 飞书→本地单向同步
 *
 * 鉴权：X-Smoke-Token == SMOKE_TOKEN（CI/smoke）或 X-Internal-Token/Authorization Bearer
 * == ZENITHJOY_INTERNAL_TOKEN（管理员/中台）。两者皆缺 → 403。生产不放行匿名。
 *
 * inject_error / mock_records 仅在 NODE_ENV != production 时被服务层采纳（生产忽略）。
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  provisionCustomerListTable,
  syncCustomerList,
  FeishuFetchError,
} from '../services/feishu-customer-list';

const router = Router();

const EXPECTED_SMOKE_TOKEN = process.env.SMOKE_TOKEN || 'smoke-secret-2026';

function ts() {
  return new Date().toISOString();
}

// 鉴权中间件：smoke token 或 internal token 命中即放行
router.use((req: Request, res: Response, next: NextFunction) => {
  const smokeTok = req.header('X-Smoke-Token');
  if (smokeTok && smokeTok === EXPECTED_SMOKE_TOKEN) return next();

  const expectedInternal = process.env.ZENITHJOY_INTERNAL_TOKEN;
  if (expectedInternal) {
    const auth = req.header('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const internalTok = req.header('X-Internal-Token') || bearer;
    if (internalTok && internalTok === expectedInternal) return next();
  }

  return res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: '缺少有效的 X-Smoke-Token 或 X-Internal-Token' },
    timestamp: ts(),
  });
});

// POST /api/feishu/customer-list/provision
router.post('/provision', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id' },
      timestamp: ts(),
    });
  }
  try {
    const result = await provisionCustomerListTable(tenantId);
    return res.json({ success: true, data: result, timestamp: ts() });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'PROVISION_FAILED', message: (err as Error).message },
      timestamp: ts(),
    });
  }
});

// POST /api/feishu/customer-list/sync
router.post('/sync', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id' },
      timestamp: ts(),
    });
  }
  try {
    const result = await syncCustomerList(tenantId, {
      injectError: req.body?.inject_error,
      mockRecords: req.body?.mock_records,
    });
    return res.json({ success: true, data: result, timestamp: ts() });
  } catch (err) {
    // 拉取失败 → 502（本地镜像已保留未动），其余 → 500
    if (err instanceof FeishuFetchError) {
      return res.status(502).json({
        success: false,
        error: { code: err.code, message: err.message },
        timestamp: ts(),
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'SYNC_FAILED', message: (err as Error).message },
      timestamp: ts(),
    });
  }
});

export default router;
export { router };
