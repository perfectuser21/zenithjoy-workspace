/**
 * Path 2 Sprint A WS3: lead-config 拉飞书 Bitable 数据路由
 *
 *  GET /api/lead-config/self      — 从 session 解析 tenantId（前端调用此接口）
 *  GET /api/lead-config/:tenantId — 拉「获客画像」+「对标视频」两表数据
 *
 * 错误路径：
 *  R3: BitableNotFoundError → 400 BITABLE_NOT_FOUND
 *  R5: TokenRefreshError    → 401 TOKEN_REFRESH_FAILED
 *  未绑：抛 FEISHU_NOT_BOUND → 400 FEISHU_NOT_BOUND
 */
import { Router, Request, Response } from 'express';
import { fetchLeadConfig } from '../services/feishu-bitable-multitenant';
import { tenantContext } from '../middleware/tenant-context';

const router = Router();

/** 复用：错误分支与 /:tenantId 完全对齐 */
async function handleFetchLeadConfig(tenantId: string, res: Response) {
  try {
    const config = await fetchLeadConfig(tenantId);
    return res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const e = err as Error & { code?: string; name?: string };
    const msg = e.message || 'INTERNAL_ERROR';
    if (e.code === 'BITABLE_NOT_FOUND' || e.name === 'BitableNotFoundError') {
      return res.status(400).json({
        success: false,
        error: { code: 'BITABLE_NOT_FOUND', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
    if (e.code === 'TOKEN_REFRESH_FAILED' || e.name === 'TokenRefreshError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_REFRESH_FAILED', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
    if (/FEISHU_NOT_BOUND/i.test(msg)) {
      return res.status(400).json({
        success: false,
        error: { code: 'FEISHU_NOT_BOUND', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
    console.error('[lead-config] 内部错误:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * GET /self — 从 session 解析 tenantId（前端 FeishuBindTenant.tsx 调此接口）
 * 注意：必须注册在 /:tenantId 之前，否则 Express 把 "self" 当 tenantId 匹配
 */
router.get('/self', tenantContext, async (req: Request, res: Response) => {
  const tenantId = (req as Request & { tenantId?: string }).tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录或无法解析 tenant' },
      timestamp: new Date().toISOString(),
    });
  }
  return handleFetchLeadConfig(tenantId, res);
});

router.get('/:tenantId', async (req: Request, res: Response) => {
  const tenantId = (req.params.tenantId || '').trim();
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺少 tenantId' },
      timestamp: new Date().toISOString(),
    });
  }
  return handleFetchLeadConfig(tenantId, res);
});

export default router;
export { router };
