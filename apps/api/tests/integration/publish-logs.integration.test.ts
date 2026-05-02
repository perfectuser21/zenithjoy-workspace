/**
 * Integration — Publish Logs Flow
 *
 * 验证：创建作品 → 发布日志 CRUD → 状态流转。
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

const USER = 'ou_publish_integ_user_001';

describe('Publish Logs Flow — integration', () => {
  let workId: string;
  let publishLogId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Publish Logs Tenant');
    await addTenantMember(tenant.id, USER, 'owner');

    // Create a work to attach publish logs to
    const res = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', USER)
      .send({
        title: '发布流程测试作品',
        content_type: 'video',
        status: 'ready',
      });
    workId = res.body.id;
  });

  afterAll(async () => {
    await truncateTables(
      'zenithjoy.publish_logs',
      'zenithjoy.works',
      'zenithjoy.tenant_members',
      'zenithjoy.tenants'
    );
  });

  it('POST /api/works/:workId/publish-logs creates a publish log', async () => {
    const res = await request(app)
      .post(`/api/works/${workId}/publish-logs`)
      .set('X-Feishu-User-Id', USER)
      .send({
        work_id: workId,
        platform: 'douyin',
        status: 'pending',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.platform).toBe('douyin');
    expect(res.body.status).toBe('pending');

    publishLogId = res.body.id;

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT id, platform FROM zenithjoy.publish_logs WHERE id = $1',
      [publishLogId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe('douyin');
  });

  it('GET /api/works/:workId/publish-logs returns the created log', async () => {
    const res = await request(app)
      .get(`/api/works/${workId}/publish-logs`)
      .set('X-Feishu-User-Id', USER);

    expect(res.status).toBe(200);
    const logs = Array.isArray(res.body) ? res.body : res.body.logs ?? res.body.data ?? [];
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.some((l: { id: string }) => l.id === publishLogId)).toBe(true);
  });

  it('PUT /api/publish-logs/:id updates status to published', async () => {
    const res = await request(app)
      .put(`/api/publish-logs/${publishLogId}`)
      .set('X-Feishu-User-Id', USER)
      .send({ status: 'published', platform_post_id: 'dy_post_999' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(res.body.platform_post_id).toBe('dy_post_999');

    // Verify in DB
    const { rows } = await testPool.query(
      'SELECT status, platform_post_id FROM zenithjoy.publish_logs WHERE id = $1',
      [publishLogId]
    );
    expect(rows[0].status).toBe('published');
    expect(rows[0].platform_post_id).toBe('dy_post_999');
  });

  it('POST /api/works/:workId/publish-logs validates platform enum', async () => {
    const res = await request(app)
      .post(`/api/works/${workId}/publish-logs`)
      .set('X-Feishu-User-Id', USER)
      .send({
        work_id: workId,
        platform: 'instagram',  // not a valid platform
        status: 'pending',
      });

    expect(res.status).toBe(400);
  });

  it('multiple platforms can be published for the same work', async () => {
    const platforms = ['xiaohongshu', 'kuaishou'];
    for (const platform of platforms) {
      const res = await request(app)
        .post(`/api/works/${workId}/publish-logs`)
        .set('X-Feishu-User-Id', USER)
        .send({ work_id: workId, platform, status: 'pending' });
      expect(res.status).toBe(201);
    }

    const { rows } = await testPool.query(
      'SELECT platform FROM zenithjoy.publish_logs WHERE work_id = $1',
      [workId]
    );
    const publishedPlatforms = rows.map((r: { platform: string }) => r.platform);
    expect(publishedPlatforms).toContain('douyin');
    expect(publishedPlatforms).toContain('xiaohongshu');
    expect(publishedPlatforms).toContain('kuaishou');
  });
});
