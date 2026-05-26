/**
 * Path 2 Sprint A WS3 + arch hotfix: 多租户飞书集成路由
 *
 *  POST /api/feishu/oauth/bind     — [ARCH] 0-touch app credentials provision（推荐）
 *                                    收 app_id/app_secret → 同步建 Bitable + 3 表 → 返 4 ID
 *  POST /api/feishu/oauth/rebuild  — [ARCH] 强制 re-provision (DELETE binding + 重建)
 *  GET  /api/feishu/oauth/status   — frontend mount 时查绑定状态
 *  POST /api/feishu/oauth/start    — [DEPRECATED] 旧 user OAuth 流程入口（保留 CI/legacy 兼容）
 *  GET  /api/feishu/oauth/callback — [DEPRECATED] 旧 OAuth 回调（保留 CI/legacy 兼容）
 *
 * 错误路径：
 *  R1 (callback 含 ?error=)        → 302 跳回 dashboard?error=<code>，不进 token 流程
 *  R2 (provisionBitable 失败)      → 502 PROVISION_FAILED + needs_retry=true
 *  R4 (binding 已存在)             → 400 ALREADY_BOUND
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { tenantContext, tenantContextOptional as tenantContextOptionalMW } from '../middleware/tenant-context';
import { getAuthorizeUrl, handleCallback } from '../services/feishu-token';
import {
  provisionBitable,
  ProvisionFailedError,
} from '../services/feishu-bitable-multitenant';

const router = Router();

/**
 * tenantContextOptional — 兼容包装：如果调用方已显式传 X-Tenant-Id 或 body.tenant_id
 * （非浏览器 caller / WS3 contract test），跳过 tenantContext 解析；否则跑 tenantContext
 * 让 dashboard 用户走 better-auth session 自动取 tenantId。
 *
 * Bug 1 fix: dashboard 不传 X-Tenant-Id，需 session 解析；保留旧 caller 行为。
 */
function tenantContextOptional(req: Request, res: Response, next: NextFunction): void {
  const explicitTenant = (req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  if (explicitTenant) {
    next();
    return;
  }
  void tenantContext(req, res, next);
}

// GET /api/feishu/oauth/status
// 前端 FeishuBindTenant mount 时调用，看当前 tenant 是否已绑定飞书
router.get('/status', tenantContextOptionalMW, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TENANT_CONTEXT', message: '当前用户未关联 tenant，请重新登录' },
      timestamp: new Date().toISOString(),
    });
  }
  try {
    const r = await pool.query(
      `SELECT
         (b.app_token IS NOT NULL) AS bound,
         b.app_token, b.bound_at, b.needs_retry,
         b.table_id_lead_profile, b.table_id_target_videos, b.table_id_leads
       FROM zenithjoy.tenants t
       LEFT JOIN zenithjoy.tenant_feishu_bindings b ON b.tenant_id = t.id
      WHERE t.id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} 不存在` },
        timestamp: new Date().toISOString(),
      });
    }
    const row = r.rows[0];
    return res.json({
      success: true,
      data: {
        bound: !!row.bound,
        app_token: row.app_token || null,
        bound_at: row.bound_at || null,
        needs_retry: !!row.needs_retry,
        bitable_doc_url: row.app_token ? `https://feishu.cn/base/${row.app_token}` : null,
        table_ids: {
          lead_profile: row.table_id_lead_profile || null,
          target_videos: row.table_id_target_videos || null,
          leads: row.table_id_leads || null,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth] /status query failed', err);
    return res.status(500).json({
      success: false,
      error: { code: 'STATUS_QUERY_FAILED', message: '查询绑定状态失败' },
      timestamp: new Date().toISOString(),
    });
  }
});

const DASHBOARD_REDIRECT =
  process.env.DASHBOARD_BASE_URL || 'http://localhost:5173';

// -------------------------------------------------------------------
// [ARCH] POST /api/feishu/oauth/bind — 0-touch app credentials provision
// 替代旧的 /start + /callback OAuth dance — 客户不需扫码
// body: { app_id, app_secret }
// header: 走 tenantContext（better-auth session）拿 tenantId
// -------------------------------------------------------------------
router.post('/bind', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = (req.tenantId || req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  const appId = (req.body?.app_id || '').trim();
  const appSecret = (req.body?.app_secret || '').trim();

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '当前用户未关联 tenant，请重新登录' },
      timestamp: new Date().toISOString(),
    });
  }
  if (!appId || !appSecret) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: '缺少 app_id 或 app_secret' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. tenant 存在性 + ALREADY_BOUND 一次 LEFT JOIN 查
    const r = await pool.query(
      `SELECT t.id, (b.app_token IS NOT NULL) AS already_bound
         FROM zenithjoy.tenants t
         LEFT JOIN zenithjoy.tenant_feishu_bindings b ON b.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} 不存在` },
        timestamp: new Date().toISOString(),
      });
    }
    if (r.rows[0].already_bound) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_BOUND', message: '该 tenant 已绑定飞书，请先解绑' },
        data: { rebind_required: true },
        timestamp: new Date().toISOString(),
      });
    }

    // 2. UPDATE tenants 灌 app_id / app_secret（getValidToken 后续读这两个字段刷 token）
    await pool.query(
      `UPDATE zenithjoy.tenants
          SET feishu_app_id = $2,
              feishu_app_secret = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [tenantId, appId, appSecret]
    );

    // 3. 同步调 provisionBitable — 建 Bitable + 3 表 + 入 bindings 表
    let result;
    try {
      result = await provisionBitable(tenantId);
    } catch (provisionErr) {
      const pe = provisionErr as Error & { code?: string; name?: string };
      if (pe instanceof ProvisionFailedError || pe.code === 'PROVISION_FAILED' || pe.name === 'ProvisionFailedError') {
        return res.status(502).json({
          success: false,
          error: { code: 'PROVISION_FAILED', message: pe.message },
          timestamp: new Date().toISOString(),
        });
      }
      throw provisionErr;
    }

    // 4. 成功 → 返回 4 ID + bitable_doc_url
    return res.json({
      success: true,
      data: {
        app_token: result.app_token,
        table_ids: {
          lead_profile: result.table_id_lead_profile,
          target_videos: result.table_id_target_videos,
          leads: result.table_id_leads,
        },
        bitable_doc_url: `https://feishu.cn/base/${result.app_token}`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth/bind] 错误:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});

// -------------------------------------------------------------------
// [ARCH] POST /api/feishu/oauth/rebuild — 强制重建 Bitable
// 客户在飞书侧删了 Bitable / 表损坏 → DELETE binding 行 + 重 provision
// header: tenantContext 拿 tenantId
// -------------------------------------------------------------------
router.post('/rebuild', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = (req.tenantId || req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺少 tenantId' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. DELETE 旧 binding（保留 tenants.feishu_app_id/secret 让 getValidToken 仍能 work）
    await pool.query(
      `DELETE FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id = $1`,
      [tenantId]
    );

    // 2. 重 provision
    let result;
    try {
      result = await provisionBitable(tenantId);
    } catch (provisionErr) {
      const pe = provisionErr as Error & { code?: string; name?: string };
      if (pe instanceof ProvisionFailedError || pe.code === 'PROVISION_FAILED' || pe.name === 'ProvisionFailedError') {
        return res.status(502).json({
          success: false,
          error: { code: 'PROVISION_FAILED', message: pe.message },
          timestamp: new Date().toISOString(),
        });
      }
      throw provisionErr;
    }

    return res.json({
      success: true,
      data: {
        app_token: result.app_token,
        table_ids: {
          lead_profile: result.table_id_lead_profile,
          target_videos: result.table_id_target_videos,
          leads: result.table_id_leads,
        },
        bitable_doc_url: `https://feishu.cn/base/${result.app_token}`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth/rebuild] 错误:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/feishu/oauth/start
// body: { app_id, app_secret }
// header: X-Tenant-Id
router.post('/start', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = (req.tenantId || req.header('X-Tenant-Id') || req.body?.tenant_id || '').trim();
  const appId = (req.body?.app_id || '').trim();
  const appSecret = (req.body?.app_secret || '').trim();

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺少 X-Tenant-Id' },
      timestamp: new Date().toISOString(),
    });
  }
  if (!appId || !appSecret) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELDS',
        message: '缺少 app_id 或 app_secret',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. tenant 存在性 + ALREADY_BOUND 一次 LEFT JOIN 查
    const r = await pool.query(
      `SELECT t.id, (b.app_token IS NOT NULL) AS already_bound
         FROM zenithjoy.tenants t
         LEFT JOIN zenithjoy.tenant_feishu_bindings b ON b.tenant_id = t.id
        WHERE t.id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} 不存在` },
        timestamp: new Date().toISOString(),
      });
    }
    if (r.rows[0].already_bound) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_BOUND', message: '该 tenant 已绑定飞书，请先解绑' },
        data: { rebind_required: true },
        timestamp: new Date().toISOString(),
      });
    }

    // 2. UPDATE tenants 灌 app_id / app_secret
    await pool.query(
      `UPDATE zenithjoy.tenants
          SET feishu_app_id = $2,
              feishu_app_secret = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [tenantId, appId, appSecret]
    );

    // 3. 生成 authorize_url + 签名 state
    const authorizeUrl = await getAuthorizeUrl(tenantId, appId);
    const stateMatch = authorizeUrl.match(/[?&]state=([^&]+)/);
    const state = stateMatch ? decodeURIComponent(stateMatch[1]) : '';

    return res.json({
      success: true,
      data: {
        authorize_url: authorizeUrl,
        state,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth/start] 错误:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: (err as Error).message,
      },
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/feishu/oauth/callback?code=xxx&state=xxx
// R1: 飞书带 ?error= 跳回 dashboard?error=<code>
router.get('/callback', async (req: Request, res: Response) => {
  const code = (req.query.code as string | undefined)?.trim();
  const state = (req.query.state as string | undefined)?.trim();
  const feishuError = (req.query.error as string | undefined)?.trim();
  const feishuErrCode = (req.query.error_code as string | undefined)?.trim();

  // R1: 飞书已带 error → 跳回 dashboard
  if (feishuError) {
    const code = feishuErrCode || feishuError;
    return res.redirect(
      `${DASHBOARD_REDIRECT}/dashboard/feishu-bind?error=${encodeURIComponent(code)}`
    );
  }

  if (!code) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_CODE', message: 'callback 缺 code' },
      timestamp: new Date().toISOString(),
    });
  }
  if (!state) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_STATE', message: 'callback 缺 state' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 1. 用 code+state 换 token + 入 tenant_feishu_bindings
    const { tenant_id } = await handleCallback(code, state);

    // 2. 串行 provisionBitable — R2 失败 → 502
    try {
      await provisionBitable(tenant_id);
    } catch (provisionErr) {
      const pe = provisionErr as Error & { code?: string; name?: string };
      if (pe.code === 'PROVISION_FAILED' || pe.name === 'ProvisionFailedError') {
        return res.status(502).json({
          success: false,
          error: {
            code: 'PROVISION_FAILED',
            message: pe.message,
          },
          timestamp: new Date().toISOString(),
        });
      }
      throw provisionErr;
    }

    // 3. 成功 → 302 回 dashboard
    return res.redirect(`${DASHBOARD_REDIRECT}/dashboard/feishu-bind?bound=1`);
  } catch (err) {
    console.error('[feishu-oauth/callback] 错误:', err);
    const e = err as Error & { code?: string; name?: string };
    if (e.code === 'TOKEN_REFRESH_FAILED' || e.name === 'TokenRefreshError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_REFRESH_FAILED', message: e.message },
        timestamp: new Date().toISOString(),
      });
    }
    const msg = e.message || 'INTERNAL_ERROR';
    if (/INVALID_STATE/i.test(msg)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message: msg },
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
export { router };
