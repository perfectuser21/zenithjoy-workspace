/**
 * Admin Users 路由测试 — PR-A 超管会员管理
 *
 * 沿用 admin-license.test.ts 的 mock pool 约定。
 *
 * 端点：
 *   GET    /api/admin/users?limit&offset&q
 *   POST   /api/admin/users/:userId/tenant-members
 *   DELETE /api/admin/users/:userId/tenant-members/:tenantId
 *   DELETE /api/admin/users/:userId
 *
 * 鉴权：superAdminGuard（X-Feishu-User-Id 白名单 或 Bearer internal-token fallback）。
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const ADMIN_ID = 'ou_admin_test_001';
const TENANT_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'usr_test_001';

function makeUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    name: 'Alice',
    emailVerified: true,
    createdAt: '2026-04-28T10:00:00.000Z',
    tenants: [
      {
        tenant_id: TENANT_UUID,
        name: 'Acme Inc',
        plan: 'pro',
        role: 'member',
      },
    ],
    ...overrides,
  };
}

describe('Admin Users 路由 (auth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FEISHU_OPENIDS = ADMIN_ID;
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'super-secret';
  });

  it('GET /api/admin/users 缺鉴权 → 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /api/admin/users 非超管 → 403', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('X-Feishu-User-Id', 'ou_random_user');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FEISHU_OPENIDS = ADMIN_ID;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('超管列表 → 200 + users 数组 + total', async () => {
    // 第 1 次：count
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '2' }] });
    // 第 2 次：users + 拼好的 tenants 聚合 jsonb
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: USER_ID,
          email: 'alice@example.com',
          name: 'Alice',
          emailVerified: true,
          createdAt: '2026-04-28T10:00:00.000Z',
          tenants: [
            { tenant_id: TENANT_UUID, name: 'Acme Inc', plan: 'pro', role: 'member' },
          ],
        },
        {
          id: 'usr_test_002',
          email: 'bob@example.com',
          name: 'Bob',
          emailVerified: false,
          createdAt: '2026-04-28T11:00:00.000Z',
          tenants: [],
        },
      ],
    });

    const res = await request(app)
      .get('/api/admin/users')
      .set('X-Feishu-User-Id', ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.users).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.users[0].email).toBe('alice@example.com');
    expect(res.body.data.users[0].tenants[0].name).toBe('Acme Inc');
    expect(res.body.data.users[1].tenants).toEqual([]);
  });

  it('支持 q 模糊搜索 email + 分页', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [makeUserRow()] });

    const res = await request(app)
      .get('/api/admin/users?q=alice&limit=10&offset=0')
      .set('X-Feishu-User-Id', ADMIN_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toHaveLength(1);
    // 校验 q 被传给 SQL（第二次 query 带 LIKE %alice%）
    const secondCall = mockQuery.mock.calls[1];
    expect(JSON.stringify(secondCall[1])).toContain('alice');
  });
});

describe('POST /api/admin/users/:userId/tenant-members', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FEISHU_OPENIDS = ADMIN_ID;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('添加成功 → 200 + 该 user 最新 tenants 数组', async () => {
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // 反查 tenants
    mockQuery.mockResolvedValueOnce({
      rows: [
        { tenant_id: TENANT_UUID, name: 'Acme Inc', plan: 'pro', role: 'admin' },
      ],
    });

    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/tenant-members`)
      .set('X-Feishu-User-Id', ADMIN_ID)
      .send({ tenant_id: TENANT_UUID, role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenants).toHaveLength(1);
    expect(res.body.data.tenants[0].role).toBe('admin');
  });

  it('缺 tenant_id → 400', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/tenant-members`)
      .set('X-Feishu-User-Id', ADMIN_ID)
      .send({ role: 'member' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('非法 role → 400', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${USER_ID}/tenant-members`)
      .set('X-Feishu-User-Id', ADMIN_ID)
      .send({ tenant_id: TENANT_UUID, role: 'pirate' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE');
  });
});

describe('DELETE /api/admin/users/:userId/tenant-members/:tenantId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FEISHU_OPENIDS = ADMIN_ID;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('成功移除 → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete(`/api/admin/users/${USER_ID}/tenant-members/${TENANT_UUID}`)
      .set('X-Feishu-User-Id', ADMIN_ID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('非 UUID tenantId → 400', async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${USER_ID}/tenant-members/not-a-uuid`)
      .set('X-Feishu-User-Id', ADMIN_ID);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TENANT_ID');
  });
});

describe('DELETE /api/admin/users/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_FEISHU_OPENIDS = ADMIN_ID;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('删除用户 → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete(`/api/admin/users/${USER_ID}`)
      .set('X-Feishu-User-Id', ADMIN_ID);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('用户不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete(`/api/admin/users/${USER_ID}`)
      .set('X-Feishu-User-Id', ADMIN_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
