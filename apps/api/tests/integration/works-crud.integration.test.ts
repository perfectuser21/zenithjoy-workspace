/**
 * Integration — Works CRUD Chain
 *
 * 验证：作品完整 CRUD 流程 + 多租户隔离。
 * 使用真实 DB（zenithjoy_test），不 mock pool.query。
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from '../../src/app';
import {
  testPool,
  truncateTables,
  createTestTenant,
  addTenantMember,
} from './helpers';

const USER_A = 'ou_works_integ_user_a';
const USER_B = 'ou_works_integ_user_b';

const WORK_PAYLOAD = {
  title: '集成测试作品',
  content_type: 'video',
  body: '这是一篇集成测试文章内容',
  status: 'draft',
};

describe('Works CRUD — integration', () => {
  let tenantAId: string;
  let tenantBId: string;
  let createdWorkId: string;

  beforeAll(async () => {
    const tenantA = await createTestTenant('Works Tenant A');
    const tenantB = await createTestTenant('Works Tenant B');
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await addTenantMember(tenantAId, USER_A, 'owner');
    await addTenantMember(tenantBId, USER_B, 'owner');
  });

  afterAll(async () => {
    await truncateTables(
      'zenithjoy.publish_logs',
      'zenithjoy.works',
      'zenithjoy.tenant_members',
      'zenithjoy.tenants'
    );
  });

  it('POST /api/works creates a work and returns 201', async () => {
    const res = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', USER_A)
      .send(WORK_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe(WORK_PAYLOAD.title);
    expect(res.body.content_type).toBe('video');
    expect(res.body.status).toBe('draft');

    createdWorkId = res.body.id;

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT id, tenant_id FROM zenithjoy.works WHERE id = $1',
      [createdWorkId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantAId);
  });

  it('GET /api/works returns works for the authenticated tenant', async () => {
    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', USER_A);

    expect(res.status).toBe(200);
    const works = Array.isArray(res.body) ? res.body : res.body.works ?? res.body.data;
    expect(Array.isArray(works)).toBe(true);
    expect(works.some((w: { id: string }) => w.id === createdWorkId)).toBe(true);
  });

  it('GET /api/works/:id returns the specific work', async () => {
    const res = await request(app)
      .get(`/api/works/${createdWorkId}`)
      .set('X-Feishu-User-Id', USER_A);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdWorkId);
    expect(res.body.title).toBe(WORK_PAYLOAD.title);
  });

  it('PUT /api/works/:id updates the work title', async () => {
    const res = await request(app)
      .put(`/api/works/${createdWorkId}`)
      .set('X-Feishu-User-Id', USER_A)
      .send({ title: '已更新的集成测试标题' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('已更新的集成测试标题');

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT title FROM zenithjoy.works WHERE id = $1',
      [createdWorkId]
    );
    expect(rows[0].title).toBe('已更新的集成测试标题');
  });

  it('tenant isolation: User B cannot see User A works', async () => {
    const res = await request(app)
      .get(`/api/works/${createdWorkId}`)
      .set('X-Feishu-User-Id', USER_B);

    // Should be 404 (not found in tenant B) or 403
    expect([403, 404]).toContain(res.status);
  });

  it('tenant isolation: GET /api/works for User B returns empty (no works in tenant B)', async () => {
    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', USER_B);

    expect(res.status).toBe(200);
    const works = Array.isArray(res.body) ? res.body : res.body.works ?? res.body.data ?? [];
    const bWorks = Array.isArray(works) ? works : [];
    expect(bWorks.some((w: { id: string }) => w.id === createdWorkId)).toBe(false);
  });

  it('DELETE /api/works/:id removes the work', async () => {
    const res = await request(app)
      .delete(`/api/works/${createdWorkId}`)
      .set('X-Feishu-User-Id', USER_A);

    expect([200, 204]).toContain(res.status);

    // Verify gone from DB
    const { rows } = await testPool.query(
      'SELECT id FROM zenithjoy.works WHERE id = $1',
      [createdWorkId]
    );
    expect(rows).toHaveLength(0);
  });
});
