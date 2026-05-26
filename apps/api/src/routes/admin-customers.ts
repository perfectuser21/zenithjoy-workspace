import { Router, Request, Response } from 'express';
import { superAdminGuard } from '../middleware/super-admin';
import pool from '../db/connection';

const router = Router();

router.use(superAdminGuard);

function nowIso(): string {
  return new Date().toISOString();
}

// ---------- GET /api/admin/customers ----------

router.get('/', async (req: Request, res: Response) => {
  try {
    const countRes = await pool.query<{ total: number | string }>(
      `SELECT count(*)::int AS total FROM tenants t`
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rows = await pool.query<{
      tenant_id: string;
      email: string;
      license_status: string;
      platform_count: number | string;
      last_publish_at: string | null;
    }>(`
      SELECT
        t.id AS tenant_id,
        COALESCE(u.email, '') AS email,
        COALESCE(l.tier, 'none') AS license_status,
        COALESCE(ps.platform_count, 0) AS platform_count,
        pl.last_publish_at
      FROM tenants t
      LEFT JOIN "user" u ON u.id = t.owner_id
      LEFT JOIN licenses l ON l.customer_id = t.owner_id AND l.revoked_at IS NULL
      LEFT JOIN (
        SELECT tenant_id, COUNT(*)::int AS platform_count
        FROM agent_platform_sessions
        GROUP BY tenant_id
      ) ps ON ps.tenant_id = t.id
      LEFT JOIN (
        SELECT tenant_id, MAX(created_at) AS last_publish_at
        FROM publish_logs
        GROUP BY tenant_id
      ) pl ON pl.tenant_id = t.id
      ORDER BY t.created_at DESC
    `);

    const data = rows.rows.map((r) => ({
      tenant_id: r.tenant_id,
      email: r.email,
      license_status: r.license_status,
      platform_count: Number(r.platform_count),
      last_publish_at: r.last_publish_at ?? null,
    }));

    return res.json({ success: true, data, total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'FETCH_FAILED', message: msg },
      timestamp: nowIso(),
    });
  }
});

// ---------- GET /api/admin/customers/platform-sessions ----------

router.get('/platform-sessions', async (req: Request, res: Response) => {
  const tenant_id = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : null;

  try {
    const params: unknown[] = [];
    let where = '';
    if (tenant_id) {
      params.push(tenant_id);
      where = `WHERE aps.tenant_id = $1`;
    }

    const countRes = await pool.query<{ total: number | string }>(
      `SELECT count(*)::int AS total FROM agent_platform_sessions aps ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rows = await pool.query<{
      session_id: string;
      tenant_id: string;
      platform: string;
      status: string;
      expires_at: string | null;
    }>(
      `SELECT
        aps.id AS session_id,
        aps.tenant_id,
        aps.platform,
        CASE
          WHEN aps.expires_at IS NULL OR aps.expires_at > NOW() THEN 'active'
          ELSE 'expired'
        END AS status,
        aps.expires_at
       FROM agent_platform_sessions aps
       ${where}
       ORDER BY aps.created_at DESC`,
      params
    );

    const data = rows.rows.map((r) => ({
      session_id: r.session_id,
      tenant_id: r.tenant_id,
      platform: r.platform,
      status: r.status,
      expires_at: r.expires_at ?? null,
    }));

    return res.json({ success: true, data, total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'FETCH_FAILED', message: msg },
      timestamp: nowIso(),
    });
  }
});

// ---------- GET /api/admin/customers/publish-logs ----------

router.get('/publish-logs', async (req: Request, res: Response) => {
  const tenant_id = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : null;

  try {
    const params: unknown[] = [];
    let where = '';
    if (tenant_id) {
      params.push(tenant_id);
      where = `WHERE pl.tenant_id = $1`;
    }

    const countRes = await pool.query<{ total: number | string }>(
      `SELECT count(*)::int AS total FROM publish_logs pl ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rows = await pool.query<{
      log_id: string;
      tenant_id: string;
      work_id: string | null;
      platform: string | null;
      status: string | null;
      created_at: string;
    }>(
      `SELECT
        pl.id AS log_id,
        pl.tenant_id,
        pl.work_id,
        pl.platform,
        pl.status,
        pl.created_at
       FROM publish_logs pl
       ${where}
       ORDER BY pl.created_at DESC`,
      params
    );

    const data = rows.rows.map((r) => ({
      log_id: r.log_id,
      tenant_id: r.tenant_id,
      work_id: r.work_id ?? null,
      platform: r.platform ?? null,
      status: r.status ?? null,
      created_at: r.created_at,
    }));

    return res.json({ success: true, data, total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'FETCH_FAILED', message: msg },
      timestamp: nowIso(),
    });
  }
});

export const adminCustomersRouter = router;
