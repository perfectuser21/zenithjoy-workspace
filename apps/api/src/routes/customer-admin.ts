/**
 * Line 10 客户管理后台路由 — 公司名 / 成员(better-auth user + tenant_members) / 客服-PC 绑定 / 诊断
 *
 * 挂载点：/api/tenant（见 app.ts）。全路由挂 superAdminGuard（超管 / internal token）。
 * 租户隔离：所有读写按路径 :id（tenant_id）过滤，成员 / 绑定绝不跨公司可见。
 *
 * 账号模型（#816 去重后）：统一到老的 better-auth 注册用户 + tenant_members，
 * 废掉 tenant_sub_accounts。客服-PC 绑定改绑真实成员（service_agents.member_user_id）。
 *
 * 端点（contract Response Schema SSOT）：
 *   PUT    /:id                                      改公司名（tenants.name）
 *   GET    /:id/members                              成员列表（tenant_members JOIN user）
 *   POST   /:id/members                              按 email 拉注册用户进本公司
 *   DELETE /:id/members/:userId                      移除成员
 *   GET    /:id/service-agents                       客服-PC 绑定列表（含 online）
 *   POST   /:id/service-agents/:userId/bind-device   把成员绑到 PC（1:1 双唯一 + 机器配额）
 *   DELETE /:id/service-agents/:bid                  软删绑定
 *
 * 诊断报告页复用既有 GET /api/agent/module-health（本文件不实现，仅前端消费）。
 */
import { Router, Request, Response } from 'express';
import { superAdminGuard } from '../middleware/super-admin';
import pool from '../db/connection';

const router = Router();

router.use(superAdminGuard);

const VALID_ROLES = new Set(['owner', 'admin', 'member']);

const ERR = {
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_INPUT: 'INVALID_INPUT',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  ALREADY_BOUND: 'ALREADY_BOUND',
  MACHINE_QUOTA_EXCEEDED: 'MACHINE_QUOTA_EXCEEDED',
  BINDING_NOT_FOUND: 'BINDING_NOT_FOUND',
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function fail(res: Response, status: number, code: string, message: string): Response {
  return res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: nowIso(),
  });
}

/** 审计 actor（who）：飞书用户 / 邮箱用户 / 内部 token 兜底 */
function actorOf(req: Request): string {
  const f = req.headers['x-feishu-user-id'];
  if (typeof f === 'string' && f.trim()) return f.trim();
  const e = req.headers['x-user-email'];
  if (typeof e === 'string' && e.trim()) return e.trim();
  return 'internal';
}

/** 写一行轻量审计（who / when / what）。审计失败不阻断主操作。 */
async function audit(
  req: Request,
  tenantId: string,
  action: string,
  targetType: string,
  targetId: string | null
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.customer_admin_audit (tenant_id, actor, action, target_type, target_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, actorOf(req), action, targetType, targetId]
    );
  } catch {
    // 审计是旁路，失败只记日志不阻断
  }
}

/** 取租户当前有效 license（tier / max_machines / id），无则 null */
async function getTenantLicense(
  tenantId: string
): Promise<{ id: string; tier: string; max_machines: number } | null> {
  const r = await pool.query<{ id: string; tier: string; max_machines: number }>(
    `SELECT id, tier, max_machines
       FROM zenithjoy.licenses
      WHERE tenant_id = $1 AND revoked_at IS NULL AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId]
  );
  return r.rows[0] ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// ──────────────────── PUT /:id — 改公司名 ────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) {
    return fail(res, 400, ERR.INVALID_NAME, '公司名不能为空');
  }
  try {
    const r = await pool.query<{ id: string; name: string }>(
      `UPDATE zenithjoy.tenants SET name = $1, updated_at = now()
        WHERE id = $2 RETURNING id, name`,
      [name, tenantId]
    );
    if (r.rowCount === 0) {
      return fail(res, 404, ERR.TENANT_NOT_FOUND, '租户不存在');
    }
    await audit(req, tenantId, 'update_tenant_name', 'tenant', tenantId);
    return res.json({ success: true, data: { tenant_id: r.rows[0].id, name: r.rows[0].name } });
  } catch (err) {
    return fail(res, 500, 'UPDATE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── GET /:id/members — 成员列表 ────────────────────
// 复用 better-auth user + tenant_members（tenant_members.feishu_user_id 存 user.id）
router.get('/:id/members', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  try {
    const rows = await pool.query<{
      user_id: string;
      email: string;
      name: string | null;
      role: string;
      joined_at: string;
    }>(
      `SELECT tm.feishu_user_id AS user_id,
              u.email,
              u.name,
              tm.role,
              tm.created_at AS joined_at
         FROM zenithjoy.tenant_members tm
         JOIN "user" u ON u.id = tm.feishu_user_id
        WHERE tm.tenant_id = $1
        ORDER BY tm.created_at ASC`,
      [tenantId]
    );
    const data = rows.rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      name: r.name ?? '',
      role: r.role,
      joined_at: r.joined_at,
    }));
    return res.json({ success: true, data, total: data.length });
  } catch (err) {
    return fail(res, 500, 'FETCH_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── POST /:id/members — 按 email 拉用户进公司 ────────────────────
router.post('/:id/members', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const role = typeof req.body?.role === 'string' && VALID_ROLES.has(req.body.role) ? req.body.role : 'member';
  if (!email) {
    return fail(res, 400, ERR.INVALID_INPUT, 'email 不能为空');
  }
  try {
    const u = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );
    if (u.rowCount === 0) {
      return fail(res, 404, ERR.USER_NOT_FOUND, '该邮箱未注册，请用户先注册再拉入');
    }
    const userId = u.rows[0].id;
    await pool.query(
      `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role = EXCLUDED.role`,
      [tenantId, userId, role]
    );
    await audit(req, tenantId, 'add_member', 'member', userId);
    return res.status(201).json({
      success: true,
      data: { user_id: userId, email: u.rows[0].email, role },
    });
  } catch (err) {
    return fail(res, 500, 'ADD_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── DELETE /:id/members/:userId — 移除成员 ────────────────────
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const userId = req.params.userId;
  try {
    // 先解绑该成员名下绑定，保持 1:1 不变式
    await pool.query(
      `UPDATE zenithjoy.service_agents
          SET deleted_at = now(), updated_at = now()
        WHERE member_user_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [userId, tenantId]
    );
    await pool.query(
      `DELETE FROM zenithjoy.tenant_members
        WHERE tenant_id = $1 AND feishu_user_id = $2`,
      [tenantId, userId]
    );
    await audit(req, tenantId, 'remove_member', 'member', userId);
    return res.json({ success: true, data: { user_id: userId, removed: true } });
  } catch (err) {
    return fail(res, 500, 'REMOVE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── GET /:id/service-agents — 客服-PC 绑定列表 ────────────────────
router.get('/:id/service-agents', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  try {
    const rows = await pool.query<{
      binding_id: string;
      member_user_id: string;
      member_email: string | null;
      machine_id: string;
      hostname: string | null;
      last_seen: string | null;
      bound_at: string;
    }>(
      `SELECT DISTINCT ON (sa.id)
              sa.id AS binding_id,
              sa.member_user_id,
              u.email AS member_email,
              sa.machine_id,
              lm.hostname,
              lm.last_seen,
              sa.created_at AS bound_at
         FROM zenithjoy.service_agents sa
         LEFT JOIN "user" u ON u.id = sa.member_user_id
         LEFT JOIN zenithjoy.licenses l ON l.tenant_id = sa.tenant_id AND l.revoked_at IS NULL
         LEFT JOIN zenithjoy.license_machines lm
                ON lm.machine_id = sa.machine_id AND lm.license_id = l.id
        WHERE sa.tenant_id = $1 AND sa.deleted_at IS NULL
        ORDER BY sa.id, lm.last_seen DESC NULLS LAST`,
      [tenantId]
    );

    const data = rows.rows
      .map((r) => {
        const last = r.last_seen ? new Date(r.last_seen).getTime() : 0;
        const online = last > 0 && Date.now() - last < 60_000;
        return {
          binding_id: r.binding_id,
          member_user_id: r.member_user_id,
          member_email: r.member_email ?? null,
          machine_id: r.machine_id,
          hostname: r.hostname ?? null,
          online,
          bound_at: r.bound_at,
        };
      })
      .sort((a, b) => (a.bound_at < b.bound_at ? 1 : -1));

    return res.json({ success: true, data, total: data.length });
  } catch (err) {
    return fail(res, 500, 'FETCH_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── POST /:id/service-agents/:userId/bind-device — 绑成员到 PC ────────────────────
router.post('/:id/service-agents/:userId/bind-device', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const memberUserId = req.params.userId;
  const machineId = typeof req.body?.machine_id === 'string' ? req.body.machine_id.trim() : '';
  if (!machineId) {
    return fail(res, 400, ERR.INVALID_INPUT, 'machine_id 不能为空');
  }

  try {
    // 成员必须属于该公司（tenant_members）
    const mem = await pool.query<{ feishu_user_id: string }>(
      `SELECT feishu_user_id FROM zenithjoy.tenant_members
        WHERE tenant_id = $1 AND feishu_user_id = $2`,
      [tenantId, memberUserId]
    );
    if (mem.rowCount === 0) {
      return fail(res, 404, ERR.MEMBER_NOT_FOUND, '该成员不属于本公司');
    }

    // 双唯一应用层预检（DB partial unique 兜底）
    const memBound = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE member_user_id = $1 AND deleted_at IS NULL`,
      [memberUserId]
    );
    if ((memBound.rowCount ?? 0) > 0) {
      return fail(res, 409, ERR.ALREADY_BOUND, '该成员已绑定 PC');
    }
    const machineBound = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE machine_id = $1 AND deleted_at IS NULL`,
      [machineId]
    );
    if ((machineBound.rowCount ?? 0) > 0) {
      return fail(res, 409, ERR.ALREADY_BOUND, '该 PC 已被绑定');
    }

    // 机器配额：绑定占用 license.max_machines。新机器（未在 license_machines）超额硬拒。
    const lic = await getTenantLicense(tenantId);
    if (lic) {
      const cntRes = await pool.query<{ cnt: number | string }>(
        `SELECT count(*)::int AS cnt FROM zenithjoy.license_machines WHERE license_id = $1`,
        [lic.id]
      );
      const existing = Number(cntRes.rows[0]?.cnt ?? 0);
      const alreadyRes = await pool.query<{ cnt: number | string }>(
        `SELECT count(*)::int AS cnt FROM zenithjoy.license_machines
          WHERE license_id = $1 AND machine_id = $2`,
        [lic.id, machineId]
      );
      const alreadyThis = Number(alreadyRes.rows[0]?.cnt ?? 0);
      if (alreadyThis === 0 && existing >= Number(lic.max_machines)) {
        return fail(
          res,
          409,
          ERR.MACHINE_QUOTA_EXCEEDED,
          `机器配额已满，当前 ${existing}/${lic.max_machines}`
        );
      }
      // 占用一个机器槽（幂等）
      await pool.query(
        `INSERT INTO zenithjoy.license_machines (license_id, machine_id)
         VALUES ($1, $2) ON CONFLICT (license_id, machine_id) DO NOTHING`,
        [lic.id, machineId]
      );
    }

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.service_agents (tenant_id, member_user_id, machine_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, memberUserId, machineId]
    );
    const bindingId = ins.rows[0].id;
    await audit(req, tenantId, 'bind_device', 'binding', bindingId);
    return res.status(201).json({
      success: true,
      data: { binding_id: bindingId, member_user_id: memberUserId, machine_id: machineId },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(res, 409, ERR.ALREADY_BOUND, '成员或 PC 已被绑定');
    }
    return fail(res, 500, 'BIND_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── DELETE /:id/service-agents/:bid — 软删绑定 ────────────────────
router.delete('/:id/service-agents/:bid', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const bindingId = req.params.bid;
  try {
    const r = await pool.query<{ id: string }>(
      `UPDATE zenithjoy.service_agents
          SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [bindingId, tenantId]
    );
    if (r.rowCount === 0) {
      return fail(res, 404, ERR.BINDING_NOT_FOUND, '绑定不存在或已删除');
    }
    await audit(req, tenantId, 'unbind_device', 'binding', bindingId);
    return res.json({ success: true, data: { binding_id: bindingId, deleted: true } });
  } catch (err) {
    return fail(res, 500, 'DELETE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

export const customerAdminRouter = router;
