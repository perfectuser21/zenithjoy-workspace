/**
 * Path 2 Sprint A WS5: DEV-only 飞书 seed helper
 *
 * 端点：POST /api/_smoke/feishu-seed
 * 双门禁：
 *   1. process.env.NODE_ENV !== 'production'  否则 404
 *   2. X-Smoke-Token 必须等 process.env.SMOKE_TOKEN（默认 'smoke-secret-2026'）  否则 403
 *
 * 内部不直接 INSERT DB — 调业务层 writeRecord(tenantId, tableId, fields)，让飞书层调用链保留。
 * 这样 CI 模式下：helper → writeRecord → axios.post(${FEISHU_API_BASE}/...) → fake-feishu-server。
 */
import { Router, Request, Response, NextFunction } from 'express';
import {
  writeRecord,
  fetchLeadConfig,
} from '../services/feishu-bitable-multitenant';
import pool from '../db/connection';

const router = Router();

const EXPECTED_SMOKE_TOKEN = process.env.SMOKE_TOKEN || 'smoke-secret-2026';

// 门禁中间件：NODE_ENV=production 一律 404；缺/错 X-Smoke-Token → 403
router.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
  }
  const tok = req.header('X-Smoke-Token');
  if (!tok || tok !== EXPECTED_SMOKE_TOKEN) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

// POST /api/_smoke/feishu-seed
// body: { tenant_id, profile: {industry, keyword, hook}, target_videos: [{url, note}] }
router.post('/feishu-seed', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  const profile = req.body?.profile || {};
  const targetVideos = req.body?.target_videos || [];

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id' },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // 取 binding 拿到 table_id_lead_profile + table_id_target_videos
    const r = await pool.query(
      `SELECT table_id_lead_profile, table_id_target_videos
         FROM zenithjoy.tenant_feishu_bindings
        WHERE tenant_id = $1`,
      [tenantId]
    );
    if (!r.rows || r.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'FEISHU_NOT_BOUND', message: '未绑飞书' },
        timestamp: new Date().toISOString(),
      });
    }
    const { table_id_lead_profile, table_id_target_videos } = r.rows[0];

    if (table_id_lead_profile && (profile.industry || profile.keyword || profile.hook)) {
      await writeRecord(tenantId, table_id_lead_profile, {
        行业: profile.industry || '',
        关键词: profile.keyword || '',
        钩子文案: profile.hook || '',
      });
    }

    for (const v of targetVideos as Array<{ url: string; note?: string }>) {
      if (!v.url) continue;
      if (!table_id_target_videos) break;
      await writeRecord(tenantId, table_id_target_videos, {
        '视频 URL': v.url,
        备注: v.note || '',
        添加时间: new Date().toISOString(),
      });
    }

    // 顺手 fetchLeadConfig 让 fake-feishu-server 缓存的内存数据立刻可读（验证用）
    let snapshot = null;
    try {
      snapshot = await fetchLeadConfig(tenantId);
    } catch {
      // ignore — seed 已写入即可
    }

    return res.json({
      success: true,
      data: { seeded: true, snapshot },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'SEED_FAILED', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
export { router };
