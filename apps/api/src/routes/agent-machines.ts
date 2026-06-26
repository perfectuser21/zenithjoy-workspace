/**
 * Line02 机器管理模块 — 中台 machines 路由
 *
 * 把既有零件（zenithjoy.agents 机器表 / agent_platform_sessions 抖音号表含 role /
 * qr-bind 派单链路）组装成统一「机器管理」后台。不重造实体。
 *
 * 4 endpoints（必须挂载在 app.use('/api/agent', agentRouter) 之前，否则被 agentRouter 吞掉）：
 *   GET    /api/agent/machines              按 tenant 列机器 + 每台抖音号数聚合
 *   GET    /api/agent/machines/:id          机器详情 + 其抖音号列表（valid 派生自 status）
 *   PUT    /api/agent/machines/:id          改名 / 改主副（machine_role）
 *   POST   /api/agent/machines/:id/add-douyin  在该机器上添加抖音号 → 复用 qr-bind 派单链路
 *
 * 信封约定（沿用 agent-burner.ts OK/ERR）：
 *   成功 { success:true, data, timestamp }；失败 { success:false, error:{code,message}, timestamp }。
 *
 * 租户来源：req.tenantId（生产 better-auth session 权威）优先，否则 ?tenant_id= / X-Tenant-Id /
 * body.tenant_id（CI/test 显式）。GET 列表/详情按 tenant scope 过滤，跨租户详情 404（不泄漏存在性）。
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';
import { tenantContextOptional } from '../middleware/tenant-context';

const router = Router();

const ERR = (code: string, message: string) => ({
  success: false,
  error: { code, message },
  timestamp: new Date().toISOString(),
});
const OK = (data: unknown) => ({
  success: true,
  data,
  timestamp: new Date().toISOString(),
});

// 机器主副枚举（≠ 号的 role）
const VALID_MACHINE_ROLES = ['main', 'sub'];
// session 有效性派生：这些状态视为「有效号」
const VALID_SESSION_STATUSES = ['active', 'connected', 'bound'];

/** 显式 tenant：?tenant_id= → X-Tenant-Id 头 → body.tenant_id（任一非空即返回）。 */
function explicitTenant(req: Request): string {
  const raw =
    (req.query?.tenant_id as string | undefined) ||
    req.header('X-Tenant-Id') ||
    (req.body && req.body.tenant_id ? String(req.body.tenant_id) : '');
  return (raw || '').toString().trim();
}

/**
 * GET 列表/详情用：显式 tenant → 直接 set req.tenantId（CI/test）；
 * 否则回落 tenantContextOptional 走 better-auth session（生产 dashboard）。
 */
function resolveTenant(req: Request, res: Response, next: NextFunction): void {
  const t = explicitTenant(req);
  if (t) {
    req.tenantId = t;
    next();
    return;
  }
  tenantContextOptional(req, res, next);
}

/**
 * PUT / add-douyin 用：显式 tenant 软附（不阻塞、无 session 也放行）。
 * 这两个动作用 :id 定位机器，没有 tenant 时按 id 兜底（mode-A BEHAVIOR 不传 tenant 也要工作）；
 * 传了 tenant 则按 tenant scope 收紧（跨租户 404，honored when provided）。
 */
function attachTenantSoft(req: Request, _res: Response, next: NextFunction): void {
  const t = explicitTenant(req);
  if (t) req.tenantId = t;
  next();
}

// 机器行 SELECT（含 douyin 号数聚合）公共片段
const MACHINE_COLUMNS = `a.id, a.nickname, a.hostname, a.status, a.version, a.machine_role,
       (SELECT count(*) FROM zenithjoy.agent_platform_sessions s
         WHERE s.agent_id = a.id AND s.platform='douyin')::int AS douyin_account_count`;

// ── 1. GET /api/agent/machines — 按 tenant 列机器 + 号数 ──
router.get('/', resolveTenant, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res
      .status(400)
      .json(ERR('MISSING_TENANT', '缺 tenant（无 session 也无 ?tenant_id=）'));
  }
  const r = await pool.query(
    `SELECT ${MACHINE_COLUMNS}
       FROM zenithjoy.agents a
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC`,
    [tenantId],
  );
  return res.json(OK({ machines: r.rows }));
});

// ── 2. GET /api/agent/machines/:id — 机器详情 + 抖音号列表 ──
router.get('/:id', resolveTenant, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res
      .status(400)
      .json(ERR('MISSING_TENANT', '缺 tenant（无 session 也无 ?tenant_id=）'));
  }
  const { id } = req.params;

  // 机器必须属当前 tenant，否则 404（不泄漏存在性）
  const m = await pool.query(
    `SELECT ${MACHINE_COLUMNS}
       FROM zenithjoy.agents a
      WHERE a.id = $1 AND a.tenant_id = $2`,
    [id, tenantId],
  );
  if (m.rows.length === 0) {
    return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属当前租户'));
  }

  // 该机器抖音号（account_nickname 子查询沿用 burner GET /sessions 写法）
  const s = await pool.query(
    `SELECT s.account_label, s.role, s.status, s.bound_at,
            (SELECT response->>'account_nickname'
               FROM zenithjoy.publish_tasks
              WHERE agent_id = s.agent_id
                AND task_type = 'qr_bind/douyin_burner'
                AND payload->>'account_label' = s.account_label
              ORDER BY created_at DESC LIMIT 1) AS account_nickname
       FROM zenithjoy.agent_platform_sessions s
      WHERE s.agent_id = $1 AND s.platform = 'douyin'
      ORDER BY s.created_at DESC`,
    [id],
  );

  const sessions = s.rows.map((row) => ({
    account_label: row.account_label,
    role: row.role,
    status: row.status,
    valid: VALID_SESSION_STATUSES.includes(row.status),
    account_nickname: row.account_nickname ?? null,
    bound_at: row.bound_at ?? null,
  }));

  return res.json(OK({ machine: m.rows[0], sessions }));
});

// ── 3. PUT /api/agent/machines/:id — 改名 / 改主副 ──
router.put('/:id', attachTenantSoft, async (req: Request, res: Response) => {
  const { nickname, machine_role } = req.body || {};
  const hasNickname = typeof nickname === 'string';
  const hasRole = machine_role !== undefined && machine_role !== null;

  if (!hasNickname && !hasRole) {
    return res.status(400).json(ERR('EMPTY_UPDATE', 'nickname 与 machine_role 至少传一项'));
  }
  if (hasRole && !VALID_MACHINE_ROLES.includes(machine_role)) {
    // 非法 role → 400 且不写库（在 query 之前拦截）
    return res
      .status(400)
      .json(ERR('INVALID_ROLE', `machine_role 必须是 main 或 sub，收到 ${machine_role}`));
  }

  const tenantId = req.tenantId || null;
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (hasNickname) {
    sets.push(`nickname = $${i++}`);
    params.push(nickname);
  }
  if (hasRole) {
    sets.push(`machine_role = $${i++}`);
    params.push(machine_role);
  }
  sets.push('updated_at = NOW()');

  const idIdx = i++;
  params.push(req.params.id);
  const tIdx = i++;
  params.push(tenantId);

  const r = await pool.query(
    `UPDATE zenithjoy.agents
        SET ${sets.join(', ')}
      WHERE id = $${idIdx}
        AND ($${tIdx}::uuid IS NULL OR tenant_id = $${tIdx}::uuid)
      RETURNING id, nickname, machine_role`,
    params,
  );
  if (r.rows.length === 0) {
    return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属当前租户'));
  }
  return res.json(OK(r.rows[0]));
});

// ── 4. POST /api/agent/machines/:id/add-douyin — 在该机器上加抖音号（复用 qr-bind 派单）──
// 回写沿用既有 POST /api/agent/burner/qr-bind-result（fake-agent / 真 Agent 都打它），不新造。
router.post('/:id/add-douyin', attachTenantSoft, async (req: Request, res: Response) => {
  const { account_label } = req.body || {};
  if (!account_label || typeof account_label !== 'string') {
    return res.status(400).json(ERR('MISSING_ACCOUNT_LABEL', 'account_label 必填'));
  }

  const tenantId = req.tenantId || null;
  const m = await pool.query(
    `SELECT id, tenant_id FROM zenithjoy.agents
      WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid)`,
    [req.params.id, tenantId],
  );
  if (m.rows.length === 0) {
    return res.status(404).json(ERR('MACHINE_NOT_FOUND', '机器不存在或不属当前租户'));
  }
  const agentId = m.rows[0].id;
  const taskTenant = m.rows[0].tenant_id;

  // 派 qr-bind 任务（与 agent-burner.ts /qr-bind 同协议：task_type/payload/status='queued'）
  const ins = await pool.query(
    `INSERT INTO zenithjoy.publish_tasks
       (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
     VALUES ($1, 'qr_bind/douyin_burner', 'queued', 'qr_bind/douyin_burner', $2, $3, NOW(), NOW())
     RETURNING id`,
    [
      agentId,
      JSON.stringify({ agent_id: agentId, account_label, tenant_id: taskTenant }),
      taskTenant,
    ],
  );

  return res.json(OK({ task_id: ins.rows[0].id }));
});

export default router;
export { router as agentMachinesRouter };
