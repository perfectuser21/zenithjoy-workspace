/**
 * Admin Users 路由 — PR-A 超管会员管理
 *
 * 全部端点 superAdminGuard 鉴权：
 *
 *   GET    /api/admin/users?limit&offset&q     — 列出 better-auth 用户 + tenants 聚合
 *   POST   /api/admin/users/:userId/tenant-members  — 拉用户进 tenant
 *   DELETE /api/admin/users/:userId/tenant-members/:tenantId  — 踢出 tenant
 *   DELETE /api/admin/users/:userId            — 删除用户（CASCADE 清 session/account/tm）
 */

import { Router, Request, Response } from 'express';
import { superAdminGuard } from '../middleware/super-admin';
import pool from '../db/connection';

export const adminUsersRouter = Router();

adminUsersRouter.use(superAdminGuard);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(['owner', 'admin', 'member']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function badRequest(res: Response, code: string, message: string) {
  return res.status(400).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: nowIso(),
  });
}

// ---------- GET /api/admin/users ----------

adminUsersRouter.get('/', async (req: Request, res: Response) => {
  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const rawOffset = parseInt(String(req.query.offset ?? ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  try {
    // count
    const countParams: unknown[] = [];
    let countWhere = '';
    if (q) {
      countParams.push(`%${q}%`);
      countWhere = `WHERE u.email ILIKE $1`;
    }
    const countSql = `SELECT count(*)::int AS total FROM "user" u ${countWhere}`;
    const countRes = await pool.query<{ total: number | string }>(countSql, countParams);
    const total = Number(countRes.rows[0]?.total ?? 0);

    // page query — 用 LATERAL 聚合每个 user 的 tenants 数组
    // 注：tenant_members.feishu_user_id 复用为成员标识列，存 better-auth user.id
    const params: unknown[] = [];
    let where = '';
    if (q) {
      params.push(`%${q}%`);
      where = `WHERE u.email ILIKE $${params.length}`;
    }
    params.push(limit);
    const limitParam = params.length;
    params.push(offset);
    const offsetParam = params.length;

    const sql = `
      SELECT
        u.id,
        u.email,
        u.name,
        u."emailVerified",
        u."createdAt",
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'tenant_id', t.id,
                'name', t.name,
                'plan', t.plan,
                'role', tm.role
              )
              ORDER BY tm.created_at ASC
            )
            FROM zenithjoy.tenant_members tm
            JOIN zenithjoy.tenants t ON t.id = tm.tenant_id
            WHERE tm.feishu_user_id = u.id
          ),
          '[]'::json
        ) AS tenants
      FROM "user" u
      ${where}
      ORDER BY u."createdAt" DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
    const { rows } = await pool.query(sql, params);

    return res.json({
      success: true,
      data: { users: rows, total },
      timestamp: nowIso(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'LIST_FAILED', message: msg },
      timestamp: nowIso(),
    });
  }
});

// ---------- POST /api/admin/users/:userId/tenant-members ----------

adminUsersRouter.post(
  '/:userId/tenant-members',
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { tenant_id, role = 'member' } = req.body ?? {};

    if (!userId || typeof userId !== 'string' || userId.length === 0) {
      return badRequest(res, 'INVALID_INPUT', 'userId 不能为空');
    }
    if (!tenant_id || typeof tenant_id !== 'string') {
      return badRequest(res, 'INVALID_INPUT', 'tenant_id 必填');
    }
    if (!UUID_RE.test(tenant_id)) {
      return badRequest(res, 'INVALID_TENANT_ID', 'tenant_id 必须是 UUID');
    }
    if (!VALID_ROLES.has(role)) {
      return badRequest(
        res,
        'INVALID_ROLE',
        'role 必须是 owner/admin/member 之一'
      );
    }

    try {
      await pool.query(
        `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, feishu_user_id) DO UPDATE SET role = EXCLUDED.role`,
        [tenant_id, userId, role]
      );

      const { rows } = await pool.query(
        `SELECT t.id AS tenant_id, t.name, t.plan, tm.role
           FROM zenithjoy.tenant_members tm
           JOIN zenithjoy.tenants t ON t.id = tm.tenant_id
          WHERE tm.feishu_user_id = $1
          ORDER BY tm.created_at ASC`,
        [userId]
      );

      return res.json({
        success: true,
        data: { tenants: rows },
        timestamp: nowIso(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'ADD_FAILED', message: msg },
        timestamp: nowIso(),
      });
    }
  }
);

// ---------- DELETE /api/admin/users/:userId/tenant-members/:tenantId ----------

adminUsersRouter.delete(
  '/:userId/tenant-members/:tenantId',
  async (req: Request, res: Response) => {
    const { userId, tenantId } = req.params;
    if (!userId) {
      return badRequest(res, 'INVALID_INPUT', 'userId 不能为空');
    }
    if (!UUID_RE.test(tenantId)) {
      return badRequest(res, 'INVALID_TENANT_ID', 'tenantId 必须是 UUID');
    }

    try {
      await pool.query(
        `DELETE FROM zenithjoy.tenant_members
          WHERE tenant_id = $1 AND feishu_user_id = $2`,
        [tenantId, userId]
      );
      return res.json({
        success: true,
        data: { success: true },
        timestamp: nowIso(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'REMOVE_FAILED', message: msg },
        timestamp: nowIso(),
      });
    }
  }
);

// ---------- DELETE /api/admin/users/:userId ----------

adminUsersRouter.delete('/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  if (!userId) {
    return badRequest(res, 'INVALID_INPUT', 'userId 不能为空');
  }

  try {
    const result = await pool.query(`DELETE FROM "user" WHERE id = $1`, [
      userId,
    ]);
    if ((result.rowCount ?? 0) === 0) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: '用户不存在' },
        timestamp: nowIso(),
      });
    }
    return res.json({
      success: true,
      data: { success: true },
      timestamp: nowIso(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'DELETE_FAILED', message: msg },
      timestamp: nowIso(),
    });
  }
});
