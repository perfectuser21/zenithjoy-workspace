/**
 * Integration — Tenant Onboarding Chain
 *
 * 验证：内部 API 创建 tenant → 管理员添加成员 → 成员能访问租户资源
 * 使用真实 DB（zenithjoy_test），不 mock pool.query。
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../src/app';
import { testPool, truncateTables } from './helpers';

const INTERNAL_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN!;
const NEW_USER = 'ou_onboarding_integration_001';

describe('Tenant Onboarding — integration', () => {
  let tenantId: string;
  let licenseKey: string;

  afterAll(async () => {
    await truncateTables('zenithjoy.tenant_members', 'zenithjoy.tenants');
  });

  it('POST /api/tenants creates a tenant with a license key', async () => {
    const res = await request(app)
      .post('/api/tenants')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({ name: 'Integration Test Co', plan: 'free' });

    expect(res.status).toBe(201);
    expect(res.body.tenant).toHaveProperty('id');
    expect(res.body.tenant).toHaveProperty('license_key');
    expect(res.body.tenant.name).toBe('Integration Test Co');

    tenantId = res.body.tenant.id;
    licenseKey = res.body.tenant.license_key;

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT id FROM zenithjoy.tenants WHERE id = $1',
      [tenantId]
    );
    expect(rows).toHaveLength(1);
  });

  it('POST /api/admin/users/:userId/tenant-members adds user to tenant', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${NEW_USER}/tenant-members`)
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({ tenant_id: tenantId, role: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT role FROM zenithjoy.tenant_members WHERE tenant_id = $1 AND feishu_user_id = $2',
      [tenantId, NEW_USER]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('member');
  });

  it('new member can access tenant-scoped endpoints', async () => {
    // After joining tenant, user should pass tenantContext and get 200 (empty list)
    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', NEW_USER);

    expect(res.status).toBe(200);
  });

  it('user not in any tenant gets 403 NO_TENANT', async () => {
    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', 'ou_unknown_user_9999');

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('NO_TENANT');
  });

  it('POST /api/tenants returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/tenants')
      .set('X-Internal-Token', INTERNAL_TOKEN)
      .send({ plan: 'free' });

    expect(res.status).toBe(400);
  });

  it('POST /api/tenants returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/tenants')
      .send({ name: 'Unauthorized Co', plan: 'free' });

    expect(res.status).toBe(401);
  });

  it('license_key format is ZJ-XXXXXXXX (8 uppercase hex chars)', () => {
    expect(licenseKey).toMatch(/^ZJ-[A-Z0-9]{8}$/);
  });
});
