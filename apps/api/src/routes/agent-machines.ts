/**
 * 机器管理模块 — machines 路由（机器列表 / 机器详情 / 改名+标主副）
 *
 * 3 endpoints（挂在 /api/agent 下，按当前租户 scope）：
 *   GET  /machines        按当前租户列机器（每台含其抖音号数量 douyin_account_count）
 *   GET  /machines/:id     机器详情 + 其抖音号列表（accounts: role / valid / ...）
 *   PUT  /machines/:id     改名 + 标主副，持久化到 zenithjoy.agents
 *
 * 鉴权：复用 tenantContextOptional（与 agent-burner 同一条闸）。
 *   - 运营带 better-auth cookie → req.tenantId（只列/改自己租户的机器）
 *   - 超管 X-Bypass-Tenant 通道 → req.tenantRole='super-admin'（旁路列全部）
 *   - 未登录 → req.tenantId 缺失 → 401 UNAUTHORIZED（不查库）
 *
 * 在机器上「加号」复用 agent-burner 的 POST /api/agent/burner/qr-bind（不在此路由新建）。
 */
import { Router, Request, Response } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';

const router = Router();

const ERR = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});

// session.status → valid（前端据此标失效 + 可重新扫码）
const VALID_SESSION_STATUSES = ['active', 'connected', 'bound'];

// ── 1. GET /machines — 按租户列机器 + 每台抖音号数量 ──
router.get('/machines', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const isSuperAdmin = req.tenantRole === 'super-admin';

  // 未登录（无 tenantId 也非超管）→ 401，不查库
  if (!tenantId && !isSuperAdmin) {
    return res.status(401).json(ERR('UNAUTHORIZED', '未登录（缺 better-auth session）'));
  }

  const params: string[] = [];
  let where = '';
  if (!isSuperAdmin) {
    params.push(tenantId as string);
    where = 'WHERE a.tenant_id = $1';
  }

  const r = await pool.query(
    `SELECT a.id,
            a.agent_id,
            a.hostname,
            COALESCE(a.nickname, a.hostname) AS nickname,
            a.machine_role,
            a.status,
            a.version,
            COALESCE(c.cnt, 0)::int AS douyin_account_count
       FROM zenithjoy.agents a
       LEFT JOIN (
         SELECT agent_id, COUNT(*) AS cnt
           FROM zenithjoy.agent_platform_sessions
          WHERE platform = 'douyin'
          GROUP BY agent_id
       ) c ON c.agent_id = a.id
       ${where}
       ORDER BY a.created_at DESC`,
    params,
  );

  return res.json({ machines: r.rows });
});

// ── 2. GET /machines/:id — 机器详情 + 其抖音号列表 ──
router.get('/machines/:id', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const isSuperAdmin = req.tenantRole === 'super-admin';
  if (!tenantId && !isSuperAdmin) {
    return res.status(401).json(ERR('UNAUTHORIZED', '未登录（缺 better-auth session）'));
  }

  const machineId = req.params.id;
  const mParams: string[] = [machineId];
  let mScope = '';
  if (!isSuperAdmin) {
    mParams.push(tenantId as string);
    mScope = 'AND a.tenant_id = $2';
  }

  const mRes = await pool.query(
    `SELECT a.id,
            COALESCE(a.nickname, a.hostname) AS nickname,
            a.machine_role,
            a.status
       FROM zenithjoy.agents a
      WHERE a.id = $1 ${mScope}`,
    mParams,
  );
  if (mRes.rows.length === 0) {
    return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属于当前租户'));
  }

  // 该机器抖音号：role / valid 派生 + nickname（从 extra_json 或 publish_tasks 回执取）
  const aRes = await pool.query(
    `SELECT s.account_label,
            s.role,
            s.status,
            COALESCE(
              s.extra_json->>'nickname',
              (SELECT response->>'account_nickname'
                 FROM zenithjoy.publish_tasks
                WHERE agent_id = s.agent_id
                  AND payload->>'account_label' = s.account_label
                ORDER BY created_at DESC LIMIT 1),
              ''
            ) AS nickname,
            (s.status = ANY($2)) AS valid
       FROM zenithjoy.agent_platform_sessions s
      WHERE s.agent_id = $1
        AND s.platform = 'douyin'
      ORDER BY s.created_at DESC`,
    [machineId, VALID_SESSION_STATUSES],
  );

  return res.json({ machine: mRes.rows[0], accounts: aRes.rows });
});

// ── 3. PUT /machines/:id — 改名 + 标主副，持久化 ──
router.put('/machines/:id', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  const isSuperAdmin = req.tenantRole === 'super-admin';
  if (!tenantId && !isSuperAdmin) {
    return res.status(401).json(ERR('UNAUTHORIZED', '未登录（缺 better-auth session）'));
  }

  const machineId = req.params.id;
  const { nickname, machine_role } = req.body || {};

  // 校验：nickname 非空字符串、machine_role ∈ {main,sub}（查库前先拦）
  if (typeof nickname !== 'string' || nickname.trim().length === 0) {
    return res.status(400).json(ERR('INVALID_INPUT', 'nickname 不能为空'));
  }
  if (machine_role !== 'main' && machine_role !== 'sub') {
    return res.status(400).json(ERR('INVALID_INPUT', 'machine_role 必须是 main 或 sub'));
  }

  const params: string[] = [machineId, nickname, machine_role];
  let scope = '';
  if (!isSuperAdmin) {
    params.push(tenantId as string);
    scope = 'AND tenant_id = $4';
  }

  const r = await pool.query(
    `UPDATE zenithjoy.agents
        SET nickname = $2, machine_role = $3, updated_at = NOW()
      WHERE id = $1 ${scope}
      RETURNING id, COALESCE(nickname, hostname) AS nickname, machine_role`,
    params,
  );

  // 0 行 = 机器不属于当前租户（跨租户改写）→ 403 CROSS_TENANT
  if (r.rows.length === 0) {
    return res.status(403).json(ERR('CROSS_TENANT', '无权修改非本租户的机器'));
  }

  return res.json({ success: true, machine: r.rows[0] });
});

export default router;
export { router as agentMachinesRouter };
