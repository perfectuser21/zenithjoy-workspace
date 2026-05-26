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
      `SELECT count(*)::int AS total FROM zenithjoy.tenants t`
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
        COALESCE(l.customer_email, '') AS email,
        COALESCE(l.tier, 'none') AS license_status,
        COALESCE(ps.platform_count, 0) AS platform_count,
        pl.last_publish_at
      FROM zenithjoy.tenants t
      LEFT JOIN zenithjoy.licenses l
        ON l.tenant_id = t.id AND l.revoked_at IS NULL
      LEFT JOIN (
        SELECT a.tenant_id, COUNT(aps.id)::int AS platform_count
        FROM zenithjoy.agents a
        JOIN zenithjoy.agent_platform_sessions aps ON aps.agent_id = a.id
        GROUP BY a.tenant_id
      ) ps ON ps.tenant_id = t.id
      LEFT JOIN (
        SELECT w.tenant_id, MAX(pl2.created_at) AS last_publish_at
        FROM zenithjoy.publish_logs pl2
        JOIN zenithjoy.works w ON w.id = pl2.work_id
        GROUP BY w.tenant_id
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
      where = `WHERE a.tenant_id = $1`;
    }

    const countRes = await pool.query<{ total: number | string }>(
      `SELECT count(aps.id)::int AS total
       FROM zenithjoy.agent_platform_sessions aps
       JOIN zenithjoy.agents a ON a.id = aps.agent_id
       ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rows = await pool.query<{
      session_id: string;
      tenant_id: string;
      platform: string;
      status: string;
    }>(
      `SELECT
        aps.id AS session_id,
        a.tenant_id,
        aps.platform,
        aps.status
       FROM zenithjoy.agent_platform_sessions aps
       JOIN zenithjoy.agents a ON a.id = aps.agent_id
       ${where}
       ORDER BY aps.created_at DESC`,
      params
    );

    const data = rows.rows.map((r) => ({
      session_id: r.session_id,
      tenant_id: r.tenant_id,
      platform: r.platform,
      status: r.status === 'expired' ? 'expired' : 'active',
      expires_at: null as string | null,
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
      where = `WHERE w.tenant_id = $1`;
    }

    const countRes = await pool.query<{ total: number | string }>(
      `SELECT count(pl.id)::int AS total
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.works w ON w.id = pl.work_id
       ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);

    const rows = await pool.query<{
      log_id: string;
      tenant_id: string | null;
      work_id: string;
      platform: string | null;
      status: string | null;
      created_at: string;
    }>(
      `SELECT
        pl.id AS log_id,
        w.tenant_id,
        pl.work_id,
        pl.platform,
        pl.status,
        pl.created_at
       FROM zenithjoy.publish_logs pl
       JOIN zenithjoy.works w ON w.id = pl.work_id
       ${where}
       ORDER BY pl.created_at DESC`,
      params
    );

    const data = rows.rows.map((r) => ({
      log_id: r.log_id,
      tenant_id: r.tenant_id ?? null,
      work_id: r.work_id,
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
