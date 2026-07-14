/**
 * DEV-only 安卓真机采集 smoke 自愈 seed helper
 *
 * 端点：POST /api/_smoke/acquisition-seed
 * 双门禁：
 *   1. NODE_ENV === 'production'  → 404
 *   2. X-Smoke-Token 必须等 process.env.SMOKE_TOKEN（默认 'smoke-secret-2026'）→ 403
 *
 * 幂等 upsert 固定真机测试租户链（tenant + license + credits + license_machines），
 * 让 line02-android-collect-realmachine-smoke.sh 派任务前自愈，抗 staging DB 重置。
 * 背景：真机 smoke 硬编码固定租户 455a8ca9 + agent a7a7b36c（物理设备绑死），
 * 环境隔离重置 zenithjoy_test 冲掉该租户 → collect/start 外键 500。
 */
import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/connection';

const router = Router();

const DEFAULT_SMOKE_TOKEN = 'smoke-secret-2026';

// 门禁中间件：NODE_ENV=production 一律 404；缺/错 X-Smoke-Token → 403
router.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'route not found' },
      timestamp: new Date().toISOString(),
    });
  }
  const tok = req.header('X-Smoke-Token');
  const expected = process.env.SMOKE_TOKEN || DEFAULT_SMOKE_TOKEN;
  if (!tok || tok !== expected) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});

// POST /api/_smoke/acquisition-seed
// body: { tenant_id, agent_id?, license_key? }
router.post('/acquisition-seed', async (req: Request, res: Response) => {
  const tenantId = req.body?.tenant_id;
  const agentId =
    typeof req.body?.agent_id === 'string' && req.body.agent_id.trim()
      ? req.body.agent_id.trim()
      : null;
  const licenseKey =
    typeof req.body?.license_key === 'string' && req.body.license_key.trim()
      ? req.body.license_key.trim()
      : 'ZJ-SMOKE-REALMACHINE';

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: { code: 'TENANT_ID_REQUIRED', message: '缺 tenant_id' },
      timestamp: new Date().toISOString(),
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
       VALUES ($1, 'realmachine-smoke', $2, 'free')
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [tenantId, licenseKey]
    );

    const lic = await client.query<{ id: string }>(
      `INSERT INTO zenithjoy.licenses
         (license_key, tier, max_machines, tenant_id, status, expires_at)
       VALUES ($1, 'enterprise', 10, $2, 'active', NOW() + INTERVAL '3650 days')
       ON CONFLICT (license_key) DO UPDATE
         SET tenant_id = EXCLUDED.tenant_id,
             max_machines = EXCLUDED.max_machines,
             tier = 'enterprise',
             status = 'active',
             updated_at = NOW()
       RETURNING id`,
      [licenseKey, tenantId]
    );
    const licenseId = lic.rows[0].id;

    await client.query(
      `INSERT INTO zenithjoy.tenant_credits (tenant_id, balance, total_recharged)
       VALUES ($1, 1000000, 1000000)
       ON CONFLICT (tenant_id) DO UPDATE SET balance = 1000000, updated_at = NOW()`,
      [tenantId]
    );

    if (agentId) {
      await client.query(
        `INSERT INTO zenithjoy.license_machines (license_id, machine_id, agent_id, status)
         VALUES ($1, $2, $2, 'active')
         ON CONFLICT (license_id, machine_id) DO UPDATE
           SET agent_id = EXCLUDED.agent_id, status = 'active', last_seen = NOW()`,
        [licenseId, agentId]
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: { seeded: true, tenant_id: tenantId, license_key: licenseKey },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({
      success: false,
      error: { code: 'SEED_FAILED', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    });
  } finally {
    client.release();
  }
});

export default router;
export { router };
