/**
 * Admin License 路由测试 — v1.2 Day 1-2
 *
 * 沿用项目现有 mock pool 约定（与 tests/topics.test.ts 等一致）。
 * 真 Postgres 集成测试 Day 3 单独加。
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const LICENSE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAR_FUTURE = new Date(Date.now() + 365 * 86400_000).toISOString();

function makeLicenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LICENSE_UUID,
    license_key: 'ZJ-B-ABCDEFGH',
    tier: 'basic',
    max_machines: 1,
    customer_id: null,
    customer_name: '测试客户',
    customer_email: null,
    status: 'active',
    issued_at: '2026-04-28T10:44:00Z',
    expires_at: FAR_FUTURE,
    revoked_at: null,
    notes: null,
    created_at: '2026-04-28T10:44:00Z',
    updated_at: '2026-04-28T10:44:00Z',
    ...overrides,
  };
}

describe('POST /api/admin/license', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('生成 basic license 成功', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeLicenseRow()] });
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'basic', customer_name: '测试客户' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tier).toBe('basic');
    expect(res.body.data.max_machines).toBe(1);
    expect(res.body.data.license_key).toMatch(/^ZJ-B-/);
  });

  it('matrix tier max_machines = 3', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeLicenseRow({
          tier: 'matrix',
          max_machines: 3,
          license_key: 'ZJ-M-AAAAAAAA',
        }),
      ],
    });
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'matrix' });
    expect(res.status).toBe(201);
    expect(res.body.data.max_machines).toBe(3);
  });

  it('tier 非法返回 400', async () => {
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'gold' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('tier 缺失返回 400', async () => {
    const res = await request(app).post('/api/admin/license').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIER');
  });

  it('email 非法返回 400', async () => {
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'basic', customer_email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_EMAIL');
  });

  it('duration_days 非法返回 400', async () => {
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'basic', duration_days: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DURATION');
  });

  it('internalAuth 拦截：无 token 时返回 401', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'super-secret';
    const res = await request(app)
      .post('/api/admin/license')
      .send({ tier: 'basic' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('internalAuth 通过：Bearer token 匹配', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'super-secret';
    mockQuery.mockResolvedValueOnce({ rows: [makeLicenseRow()] });
    const res = await request(app)
      .post('/api/admin/license')
      .set('Authorization', 'Bearer super-secret')
      .send({ tier: 'basic' });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/admin/license', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('列出全部 license', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeLicenseRow(),
        makeLicenseRow({
          id: 'bbb',
          license_key: 'ZJ-M-XXXXXXXX',
          tier: 'matrix',
        }),
      ],
    });
    const res = await request(app).get('/api/admin/license');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
  });
});

describe('DELETE /api/admin/license/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('成功 revoke', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/api/admin/license/${LICENSE_UUID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(true);
  });

  it('找不到/已 revoked 返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete(`/api/admin/license/${LICENSE_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('非 UUID 返回 400', async () => {
    const res = await request(app).delete('/api/admin/license/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ID');
  });
});
