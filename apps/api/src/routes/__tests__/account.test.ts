/**
 * GET /api/account/me — 已登录客户自查端点
 *
 * Walking Skeleton #1 license loop 修复：客户注册后 Dashboard 看不到自己的
 * free license_key（注册响应不返；admin/license/me 走 X-Feishu-User-Id 不通用）。
 * 本端点用 better-auth session 鉴权，返回 user + 当前 license（裁剪到 4 字段）。
 *
 * 三个核心 case：
 *  1. 无 cookie / session 解析失败 → 401
 *  2. 有效 session + DB 有 license → 200, license.license_key 正确
 *  3. 有效 session + DB 无 license → 200, license: null（注册流程未跑完时不报 404）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import app from '../../app';
import pool from '../../db/connection';
import { auth } from '../../auth';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'walker@zenithjoy.test',
  name: 'WS1 Walker',
};

const LICENSE_DB_ROW = {
  license_key: 'ZJ-F-ABCDEFGH',
  tier: 'free',
  max_machines: 1,
  expires_at: '2036-05-07T00:00:00.000Z',
  // 内部字段（response 裁剪后不应出现）
  customer_id: USER.id,
  status: 'active',
  id: '22222222-2222-2222-2222-222222222222',
};

describe('GET /api/account/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未登录（无 better-auth session）→ 401', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/account/me');

    expect(res.status).toBe(401);
    expect(res.body?.error?.message).toMatch(/未登录/);
    // 401 前不应查 DB
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('有效 session + 用户有 license → 200，返回裁剪后的 license 字段', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: USER.id, email: USER.email, name: USER.name },
      session: { id: 'sess-1' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [LICENSE_DB_ROW] });

    const res = await request(app)
      .get('/api/account/me')
      .set('Cookie', 'better-auth.session_token=stub');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: USER.id,
      email: USER.email,
      name: USER.name,
    });
    expect(res.body.license).toEqual({
      license_key: 'ZJ-F-ABCDEFGH',
      tier: 'free',
      max_machines: 1,
      expires_at: '2036-05-07T00:00:00.000Z',
    });
    // 不暴露内部字段
    expect(res.body.license).not.toHaveProperty('customer_id');
    expect(res.body.license).not.toHaveProperty('status');
    expect(res.body.license).not.toHaveProperty('id');

    // SQL 用 customer_id 反查
    const params = mockQuery.mock.calls[0]?.[1] as unknown[];
    expect(params).toEqual([USER.id]);
  });

  it('有效 session + 用户无 license（注册流程未跑完）→ 200, license: null', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: USER.id, email: USER.email, name: USER.name },
      session: { id: 'sess-2' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/account/me')
      .set('Cookie', 'better-auth.session_token=stub');

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(USER.id);
    expect(res.body.license).toBeNull();
  });
});
