/**
 * Line 10 客户管理后台路由 — 公司名 / 子账号(role+配额) / 客服-PC 绑定(1:1 双唯一) / 诊断
 *
 * 挂载点：/api/tenant（见 app.ts）。全路由挂 superAdminGuard（超管 / internal token）。
 * 租户隔离：所有读写按路径 :id（tenant_id）过滤，子账号 / 绑定绝不跨公司可见。
 *
 * 端点（contract-draft.md Response Schema SSOT）：
 *   PUT    /:id                                   改公司名（tenants.name）
 *   GET    /:id/accounts                          子账号列表 + 配额
 *   POST   /:id/accounts                          建子账号（role + plan 配额硬拒）
 *   DELETE /:id/accounts/:aid                     软删子账号
 *   GET    /:id/service-agents                    客服-PC 绑定列表（含 online）
 *   POST   /:id/service-agents/:aid/bind-device   绑客服到 PC（1:1 双唯一 + 机器配额）
 *   DELETE /:id/service-agents/:bid               软删绑定
 *
 * 诊断报告页复用既有 GET /api/agent/module-health（本文件不实现，仅前端消费）。
 */
import { Router, Request, Response } from 'express';
import { superAdminGuard } from '../middleware/super-admin';
import pool from '../db/connection';
import { computeSubAccountLimit } from '../lib/sub-account-quota';
import {
  isValidRole,
  assertBindable,
  CUSTOMER_ADMIN_ERROR_CODES as E,
} from '../lib/customer-admin-rules';

const router = Router();

router.use(superAdminGuard);

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
    return fail(res, 400, E.INVALID_NAME, '公司名不能为空');
  }
  try {
    const r = await pool.query<{ id: string; name: string }>(
      `UPDATE zenithjoy.tenants SET name = $1, updated_at = now()
        WHERE id = $2 RETURNING id, name`,
      [name, tenantId]
    );
    if (r.rowCount === 0) {
      return fail(res, 404, E.TENANT_NOT_FOUND, '租户不存在');
    }
    await audit(req, tenantId, 'update_tenant_name', 'tenant', tenantId);
    return res.json({ success: true, data: { tenant_id: r.rows[0].id, name: r.rows[0].name } });
  } catch (err) {
    return fail(res, 500, 'UPDATE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── GET /:id/accounts — 子账号列表 + 配额 ────────────────────
router.get('/:id/accounts', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  try {
    const lic = await getTenantLicense(tenantId);
    const limit = computeSubAccountLimit(lic?.tier);

    const rows = await pool.query<{
      account_id: string;
      email: string;
      display_name: string;
      role: string;
      created_at: string;
    }>(
      `SELECT id AS account_id, email, display_name, role, created_at
         FROM zenithjoy.tenant_sub_accounts
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [tenantId]
    );

    const data = rows.rows.map((r) => ({
      account_id: r.account_id,
      email: r.email,
      display_name: r.display_name,
      role: r.role,
      created_at: r.created_at,
    }));

    return res.json({
      success: true,
      data,
      total: data.length,
      quota: { used: data.length, limit },
    });
  } catch (err) {
    return fail(res, 500, 'FETCH_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── POST /:id/accounts — 建子账号 ────────────────────
router.post('/:id/accounts', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim() : '';
  const role = req.body?.role;

  if (!isValidRole(role)) {
    return fail(res, 400, E.INVALID_ROLE, `非法角色：${String(role)}`);
  }
  if (!email) {
    return fail(res, 400, E.INVALID_NAME, '邮箱不能为空');
  }

  try {
    const tenant = await pool.query(`SELECT id FROM zenithjoy.tenants WHERE id = $1`, [tenantId]);
    if (tenant.rowCount === 0) {
      return fail(res, 404, E.TENANT_NOT_FOUND, '租户不存在');
    }

    const lic = await getTenantLicense(tenantId);
    const limit = computeSubAccountLimit(lic?.tier);
    const usedRes = await pool.query<{ used: number | string }>(
      `SELECT count(*)::int AS used
         FROM zenithjoy.tenant_sub_accounts
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    const used = Number(usedRes.rows[0]?.used ?? 0);
    if (used >= limit) {
      return fail(res, 409, E.SUBACCOUNT_QUOTA_EXCEEDED, `配额已满，当前 ${used}/${limit}`);
    }

    const dup = await pool.query(
      `SELECT 1 FROM zenithjoy.tenant_sub_accounts
        WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
      [tenantId, email]
    );
    if ((dup.rowCount ?? 0) > 0) {
      return fail(res, 409, E.EMAIL_EXISTS, '该邮箱已存在');
    }

    const ins = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      role: string;
    }>(
      `INSERT INTO zenithjoy.tenant_sub_accounts (tenant_id, email, display_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, role`,
      [tenantId, email, displayName, role]
    );
    const row = ins.rows[0];
    await audit(req, tenantId, 'create_account', 'sub_account', row.id);
    return res.status(201).json({
      success: true,
      data: { account_id: row.id, email: row.email, display_name: row.display_name, role: row.role },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(res, 409, E.EMAIL_EXISTS, '该邮箱已存在');
    }
    return fail(res, 500, 'CREATE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── DELETE /:id/accounts/:aid — 软删子账号 ────────────────────
router.delete('/:id/accounts/:aid', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const accountId = req.params.aid;
  try {
    const r = await pool.query<{ id: string }>(
      `UPDATE zenithjoy.tenant_sub_accounts
          SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [accountId, tenantId]
    );
    if (r.rowCount === 0) {
      return fail(res, 404, E.ACCOUNT_NOT_FOUND, '子账号不存在或已删除');
    }
    // 连带软删该账号的有效绑定（保持 1:1 不变式）
    await pool.query(
      `UPDATE zenithjoy.service_agents
          SET deleted_at = now(), updated_at = now()
        WHERE account_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [accountId, tenantId]
    );
    await audit(req, tenantId, 'delete_account', 'sub_account', accountId);
    return res.json({ success: true, data: { account_id: accountId, deleted: true } });
  } catch (err) {
    return fail(res, 500, 'DELETE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

// ──────────────────── GET /:id/service-agents — 客服-PC 绑定列表 ────────────────────
router.get('/:id/service-agents', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  try {
    const rows = await pool.query<{
      binding_id: string;
      account_id: string;
      account_email: string;
      machine_id: string;
      hostname: string | null;
      last_seen: string | null;
      bound_at: string;
    }>(
      `SELECT DISTINCT ON (sa.id)
              sa.id AS binding_id,
              sa.account_id,
              a.email AS account_email,
              sa.machine_id,
              lm.hostname,
              lm.last_seen,
              sa.created_at AS bound_at
         FROM zenithjoy.service_agents sa
         JOIN zenithjoy.tenant_sub_accounts a ON a.id = sa.account_id
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
          account_id: r.account_id,
          account_email: r.account_email,
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

// ──────────────────── POST /:id/service-agents/:aid/bind-device — 绑客服到 PC ────────────────────
router.post('/:id/service-agents/:aid/bind-device', async (req: Request, res: Response) => {
  const tenantId = req.params.id;
  const accountId = req.params.aid;
  const machineId = typeof req.body?.machine_id === 'string' ? req.body.machine_id.trim() : '';
  if (!machineId) {
    return fail(res, 400, E.INVALID_NAME, 'machine_id 不能为空');
  }

  try {
    const acc = await pool.query<{ role: string }>(
      `SELECT role FROM zenithjoy.tenant_sub_accounts
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [accountId, tenantId]
    );
    if (acc.rowCount === 0) {
      return fail(res, 404, E.ACCOUNT_NOT_FOUND, '子账号不存在');
    }
    try {
      assertBindable({ role: acc.rows[0].role });
    } catch {
      return fail(res, 400, E.INVALID_BIND_ROLE, '只有 service_agent 角色可绑 PC');
    }

    // 双唯一应用层预检（DB partial unique 兜底）
    const accBound = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE account_id = $1 AND deleted_at IS NULL`,
      [accountId]
    );
    if ((accBound.rowCount ?? 0) > 0) {
      return fail(res, 409, E.ALREADY_BOUND, '该客服已绑定 PC');
    }
    const machineBound = await pool.query(
      `SELECT 1 FROM zenithjoy.service_agents
        WHERE machine_id = $1 AND deleted_at IS NULL`,
      [machineId]
    );
    if ((machineBound.rowCount ?? 0) > 0) {
      return fail(res, 409, E.ALREADY_BOUND, '该 PC 已被绑定');
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
          E.MACHINE_QUOTA_EXCEEDED,
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
      `INSERT INTO zenithjoy.service_agents (tenant_id, account_id, machine_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, accountId, machineId]
    );
    const bindingId = ins.rows[0].id;
    await audit(req, tenantId, 'bind_device', 'binding', bindingId);
    return res.status(201).json({
      success: true,
      data: { binding_id: bindingId, account_id: accountId, machine_id: machineId },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(res, 409, E.ALREADY_BOUND, '客服或 PC 已被绑定');
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
      return fail(res, 404, E.BINDING_NOT_FOUND, '绑定不存在或已删除');
    }
    await audit(req, tenantId, 'unbind_device', 'binding', bindingId);
    return res.json({ success: true, data: { binding_id: bindingId, deleted: true } });
  } catch (err) {
    return fail(res, 500, 'DELETE_FAILED', err instanceof Error ? err.message : 'unknown');
  }
});

export const customerAdminRouter = router;
