/**
 * Sprint B · WS1+WS2 — works 表多租户隔离集成测试
 *
 * 覆盖：
 *  - GET /api/works 缺 X-Feishu-User-Id 返回 401
 *  - GET /api/works 客户 A 只返回 owner_id=A 的作品
 *  - POST /api/works 自动 SET owner_id 为请求者飞书 ID
 *  - POST /api/works 忽略 body 中的 owner_id（防伪造）
 *  - GET /api/works/:id 跨租户访问返回 404
 *  - PUT /api/works/:id 跨租户修改返回 404
 *  - DELETE /api/works/:id 跨租户删除返回 404
 *  - super-admin X-Bypass-Tenant=true 返回全部作品
 */
import request from 'supertest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const ALICE = 'ou_alice_001';
const BOB = 'ou_bob_002';
const ADMIN = 'ou_admin_999';

const ALICE_WORK = {
  id: '11111111-aaaa-bbbb-cccc-111111111111',
  title: 'Alice 作品',
  body: 'A 的内容',
  body_en: null,
  content_type: 'article',
  cover_image: null,
  media_files: null,
  platform_links: null,
  status: 'draft',
  account: null,
  is_featured: false,
  is_viral: false,
  custom_fields: null,
  archived_at: null,
  owner_id: ALICE,
  scheduled_at: null,
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
};

const BOB_WORK = { ...ALICE_WORK, id: '22222222-aaaa-bbbb-cccc-222222222222', title: 'Bob 作品', owner_id: BOB };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_FEISHU_OPENIDS', ADMIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Sprint B — works 多租户 [BEHAVIOR]', () => {
  it('GET /api/works 缺 X-Feishu-User-Id 返回 401', async () => {
    const res = await request(app).get('/api/works');
    expect(res.status).toBe(401);
  });

  it('GET /api/works 客户 A 只返回 owner_id=A 的作品', async () => {
    // 期望 service 用 owner_id=ALICE 过滤；mock 只返回 ALICE_WORK 模拟 SQL 已过滤
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [ALICE_WORK] });

    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', ALICE);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].owner_id).toBe(ALICE);
    // 验证服务端 SQL 含 owner_id 过滤
    const calls = mockQuery.mock.calls;
    const sqls = calls.map((c) => String(c[0])).join('\n');
    expect(sqls).toMatch(/owner_id\s*=\s*\$/);
  });

  it('POST /api/works 自动 SET owner_id 为请求者飞书 ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ALICE_WORK] });

    const res = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', ALICE)
      .send({
        title: 'Alice 作品',
        content_type: 'article',
        body: 'A 的内容',
      });

    expect(res.status).toBe(201);
    expect(res.body.owner_id).toBe(ALICE);
    // INSERT SQL 应将 ownerId 作为参数之一传入
    const calls = mockQuery.mock.calls;
    const insertCall = calls.find((c) => String(c[0]).match(/INSERT\s+INTO\s+zenithjoy\.works/i));
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params).toContain(ALICE);
  });

  it('POST /api/works 忽略 body 中的 owner_id 字段（防伪造）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [ALICE_WORK] });

    const res = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', ALICE)
      .send({
        title: 'Alice 作品',
        content_type: 'article',
        body: '...',
        owner_id: BOB, // 试图伪造
      });

    expect(res.status).toBe(201);
    // 服务端使用 ALICE 而非 BOB
    const calls = mockQuery.mock.calls;
    const insertCall = calls.find((c) => String(c[0]).match(/INSERT\s+INTO\s+zenithjoy\.works/i));
    const params = insertCall![1] as unknown[];
    expect(params).toContain(ALICE);
    expect(params).not.toContain(BOB);
  });

  it('GET /api/works/:id 跨租户访问返回 404 NOT_FOUND', async () => {
    // service 拿到行后比对 owner_id != ALICE → 视为 NOT_FOUND
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .get(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', ALICE);

    expect(res.status).toBe(404);
  });

  it('PUT /api/works/:id 跨租户修改返回 404 NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .put(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', ALICE)
      .send({ title: '篡改' });

    expect(res.status).toBe(404);
  });

  it('DELETE /api/works/:id 跨租户删除返回 404 NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .delete(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', ALICE);

    expect(res.status).toBe(404);
  });

  it('super-admin X-Bypass-Tenant=true 返回全部作品（跨租户）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [ALICE_WORK, BOB_WORK] });

    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', ADMIN)
      .set('X-Bypass-Tenant', 'true');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    // bypass 模式下 SQL 不应含 owner_id 过滤
    const calls = mockQuery.mock.calls;
    const sqls = calls.map((c) => String(c[0])).join('\n');
    expect(sqls).not.toMatch(/owner_id\s*=\s*\$/);
  });
});
