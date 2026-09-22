/**
 * Path 2 Sprint B-1 WS3 — DEV-only fake-agent burner helper
 *
 * 端点：POST /api/_smoke/fake-agent-burner-progress
 * 双门禁：
 *   1. process.env.NODE_ENV !== 'production'  否则 404
 *   2. X-Smoke-Token 必须等 process.env.SMOKE_TOKEN（默认 'smoke-secret-2026'）  否则 403
 *
 * CI 模式：smoke 在派完 burner task 后调本端点模拟 Agent 上报"chrome_launched"中间 phase。
 * 不绕过业务路由 — qr-bind-result / crawl-comments-result 真路由直接由 smoke 调。
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

const router = Router();

const EXPECTED_SMOKE_TOKEN = process.env.SMOKE_TOKEN || 'smoke-secret-2026';

router.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
  }
  const tok = req.header('X-Smoke-Token');
  // 每次请求重读 env，防 import-time 缓存
  const expected = process.env.SMOKE_TOKEN || EXPECTED_SMOKE_TOKEN;
  if (!tok || tok !== expected) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

// POST /api/_smoke/fake-agent-burner-progress
// body: { task_id, phase, user_data_dir?, current_url? }
router.post('/fake-agent-burner-progress', async (req: Request, res: Response) => {
  const { task_id, phase, user_data_dir, current_url } = req.body || {};
  if (!task_id || !phase) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'task_id + phase 必填' },
      timestamp: new Date().toISOString(),
    });
  }

  const r = await pool.query(
    `UPDATE zenithjoy.publish_tasks
        SET status='running',
            response = jsonb_build_object(
              'phase', $2::text,
              'user_data_dir', $3::text,
              'current_url', $4::text
            ),
            updated_at = NOW()
      WHERE id=$1
      RETURNING id`,
    [task_id, phase, user_data_dir || '', current_url || ''],
  );

  if (r.rows.length === 0) {
    return res.status(404).json({
      success: false,
      error: { code: 'TASK_NOT_FOUND', message: 'task_id 未找到' },
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    data: { task_id, phase, recorded: true },
    timestamp: new Date().toISOString(),
  });
});

export default router;
export { router as smokeFakeAgentBurnerRouter };
