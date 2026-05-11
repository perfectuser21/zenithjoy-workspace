/**
 * Path 2 Sprint B-1 architecture hotfix — mock-agent helper (生产可调，X-Smoke-Token 单门禁)
 *
 * 端点：POST /api/_smoke/mock-agent
 *
 * 用途：lead 自验脚本走完 sign-up + 飞书 bind 后，需要模拟"客户已装 Agent"
 * 让后续 qr-bind 路由的 agentContext middleware 能命中一行 active agent。
 * 真生产环境的 agent register 走 ZenithJoy Agent 客户机程序 + heartbeat，
 * 此 endpoint 仅作 lead 自验便捷入口。
 *
 * H-2 Bug 3 fix：
 *   - 拆掉旧 NODE_ENV=production 硬 404，改由 X-Smoke-Token 单一鉴权
 *   - 生产必须显式设 SMOKE_TOKEN env (无 fallback)，防 default secret 'smoke-secret-2026' 泄漏
 *   - 缺 SMOKE_TOKEN env 在 production → 503 SMOKE_TOKEN_NOT_CONFIGURED (运维信号，提示需配置)
 *
 * Body: { tenant_id: UUID, agent_id_text: string, hostname?: string }
 * 行为：UPSERT zenithjoy.agents (tenant_id, agent_id, hostname, status='online')
 *      ON CONFLICT (agent_id) DO UPDATE 同步 status + last_seen
 *      返：{ agent_uuid: agents.id }
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

const router = Router();

// H-2 Bug 3 fix: 拆 NODE_ENV=production 硬 404，X-Smoke-Token 单一鉴权。
// 生产必须显式设 SMOKE_TOKEN env (无 fallback)，防 default secret 泄漏。
router.use('/mock-agent', (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production' && !process.env.SMOKE_TOKEN) {
    return res.status(503).json({
      success: false,
      error: { code: 'SMOKE_TOKEN_NOT_CONFIGURED', message: 'SMOKE_TOKEN env required in production' },
      timestamp: new Date().toISOString(),
    });
  }
  const expected = process.env.SMOKE_TOKEN || 'smoke-secret-2026'; // dev/test fallback only
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
