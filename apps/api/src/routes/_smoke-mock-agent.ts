/**
 * Path 2 Sprint B-1 architecture hotfix — DEV-only mock-agent helper
 *
 * 端点：POST /api/_smoke/mock-agent
 *
 * 用途：lead 自验脚本走完 sign-up + 飞书 bind 后，需要模拟"客户已装 Agent"
 * 让后续 qr-bind 路由的 agentContext middleware 能命中一行 active agent。
 * 真生产环境的 agent register 走 ZenithJoy Agent 客户机程序 + heartbeat，
 * 此 endpoint 仅作 lead 自验便捷入口。
 *
 * 双门禁：
 *   1. NODE_ENV !== 'production'  否则 404
 *   2. X-Smoke-Token === SMOKE_TOKEN（默认 'smoke-secret-2026'）  否则 403
 *
 * Body: { tenant_id: UUID, agent_id_text: string, hostname?: string }
 * 行为：UPSERT zenithjoy.agents (tenant_id, agent_id, hostname, status='online')
 *      ON CONFLICT (agent_id) DO UPDATE 同步 status + last_seen
 *      返：{ agent_uuid: agents.id }
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

const router = Router();

const EXPECTED_SMOKE_TOKEN = process.env.SMOKE_TOKEN || 'smoke-secret-2026';

// 门禁中间件：NODE_ENV=production 一律 404；缺/错 X-Smoke-Token → 403
router.use('/mock-agent', (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
  }
  const expected = process.env.SMOKE_TOKEN || EXPECTED_SMOKE_TOKEN;
  const tok = req.header('X-Smoke-Token');
  if (!tok || tok !== expected) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

router.post('/mock-agent', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  const agentIdText = req.body?.agent_id_text;
  const hostname = req.body?.hostname || 'lead-self-test-host';

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id (UUID)' },
      timestamp: new Date().toISOString(),
    });
  }
  if (!agentIdText || typeof agentIdText !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'AGENT_ID_TEXT_REQUIRED',
        message: '缺 agent_id_text（hostname-friendly 文字串，例 xian-rog-agent）',
      },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.agents (tenant_id, agent_id, hostname, status, last_seen)
         VALUES ($1, $2, $3, 'online', now())
       ON CONFLICT (agent_id) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             hostname  = EXCLUDED.hostname,
             status    = 'online',
             last_seen = now(),
             updated_at = now()
       RETURNING id`,
      [tenantId, agentIdText, hostname]
    );
    return res.json({
      success: true,
      data: { agent_uuid: r.rows[0].id, agent_id_text: agentIdText },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'MOCK_AGENT_FAILED', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
export { router as smokeMockAgentRouter };
