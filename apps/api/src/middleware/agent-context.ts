/**
 * agentContext 中间件 — 解析当前 user 到对应 tenant 的 active agent UUID
 *
 * Path 2 Sprint B-1 architecture hotfix（类比 tenantContext）:
 *   frontend / lead 自验都不知道当前 user 的 agent UUID（agents.id 是 UUID PK）。
 *   原 PR #281 设计成 body 必填 agent_id → caller 传 text agent_id 字符串
 *   → backend INSERT publish_tasks(agent_id UUID) → postgres 报
 *      "invalid input syntax for type uuid: \"xian-rog-agent\""
 *
 * 用法（必须先经 tenantContext）：
 *   router.post('/qr-bind', tenantContext, agentContext, async (req, res) => {
 *     const agentId = req.agentId; // UUID
 *   });
 *
 * 行为：
 *   1. 若 body.agent_id 显式传入（向后兼容 supertest / non-browser caller）→ 直接 req.agentId = body.agent_id, next()
 *   2. 否则：req.tenantId 必须 set（agentContext 应在 tenantContext 之后挂载）；缺 → 401 NO_TENANT_FOR_AGENT_CONTEXT
 *   3. SELECT id FROM zenithjoy.agents WHERE tenant_id=$1 AND status='online' ORDER BY created_at DESC LIMIT 1
 *      命中 → req.agentId = id；空 → 401 NO_AGENT_CONTEXT
 *   4. DB 异常 → 500 AGENT_LOOKUP_FAILED
 *
 * 错误码：
 *   401 NO_TENANT_FOR_AGENT_CONTEXT — req.tenantId 未 set（middleware 顺序问题）
 *   401 NO_AGENT_CONTEXT            — tenant 没 active agent（user 还没装 agent）
 *   500 AGENT_LOOKUP_FAILED         — DB 异常
 */
import type { Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

declare module 'express-serve-static-core' {
  interface Request {
    agentId?: string;
  }
}

interface AgentRow {
  id: string;
}

export async function agentContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. body 显式 agent_id 优先（向后兼容现有 supertest integration test + 非浏览器 caller）
  const bodyAgentId =
    req.body && typeof req.body.agent_id === 'string' && req.body.agent_id.length > 0
      ? req.body.agent_id
      : '';
  if (bodyAgentId) {
    req.agentId = bodyAgentId;
    next();
    return;
  }

  // 2. 必须先经 tenantContext
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(401).json({
      success: false,
      data: null,
      error: {
        code: 'NO_TENANT_FOR_AGENT_CONTEXT',
        message:
          'agentContext middleware 必须在 tenantContext 之后挂载（缺 req.tenantId）',
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // 3. 查 agents 表 — 身份统一：优先取该 tenant 的 license.pinned_agent_id（与心跳/me/status 投递落到同一去重行），
  //    避免 qr-bind 派单投到裂出的另一行 → 任务卡 queued。pinned 为空/已废时兜底取最新 online 行。
  try {
    const { rows } = await pool.query<AgentRow>(
      `SELECT a.id
         FROM zenithjoy.agents a
        WHERE a.tenant_id = $1 AND a.status = 'online'
        ORDER BY
          CASE WHEN a.id = (
            SELECT l.pinned_agent_id FROM zenithjoy.licenses l
             WHERE l.tenant_id = $1 AND l.pinned_agent_id IS NOT NULL
             ORDER BY l.updated_at DESC NULLS LAST
             LIMIT 1
          ) THEN 0 ELSE 1 END ASC,
          a.created_at DESC
        LIMIT 1`,
      [tenantId]
    );

    if (rows.length === 0) {
      res.status(401).json({
        success: false,
        data: null,
        error: {
          code: 'NO_AGENT_CONTEXT',
          message:
            '当前 tenant 无 active agent — 请先在客户机装 ZenithJoy Agent 并完成 register/heartbeat',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    req.agentId = rows[0].id;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({
      success: false,
      data: null,
      error: { code: 'AGENT_LOOKUP_FAILED', message: msg },
      timestamp: new Date().toISOString(),
    });
  }
}
