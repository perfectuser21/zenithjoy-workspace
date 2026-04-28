/**
 * Tenant 统一隔离集成测试（v2 — 取代 Sprint B 的 owner_id 方案）
 *
 * 主理人决策（2026-04-28）：同公司多人共享作品 → tenant 级隔离，owner_id 仅审计
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
const NOT_A_MEMBER = 'ou_orphan_404';

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

const ALICE_WORK = {
  id: '11111111-aaaa-bbbb-cccc-111111111111',
  title: 'Alice 作品',
  body: 'A 的内容',
  body_en: null,
  content_type: 'video',
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
  tenant_id: TENANT_A,
  scheduled_at: null,
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
};

const BOB_WORK = { ...ALICE_WORK, id: '22222222-aaaa-bbbb-cccc-222222222222', title: 'Bob 作品', owner_id: BOB };
const CAROL_WORK = { ...ALICE_WORK, id: '33333333-aaaa-bbbb-cccc-333333333333', title: 'Carol 作品', owner_id: 'ou_carol_003', tenant_id: TENANT_B };

function mockTenantMember(tenantId: string, role = 'member') {
  mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: tenantId, role }] });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_FEISHU_OPENIDS', ADMIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Tenant 级隔离 [BEHAVIOR]', () => {
  it('GET /api/works 缺 X-Feishu-User-Id 返回 401', async () => {
    const res = await request(app).get('/api/works');
    expect(res.status).toBe(401);
  });

  it('用户无 tenant_member 关联返回 403 NO_TENANT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', NOT_A_MEMBER);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NO_TENANT');
  });

  it('GET /api/works 同 tenant 用户看到 tenant 的作品（Bob 看 Alice）', async () => {
    mockTenantMember(TENANT_A);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [ALICE_WORK] });

    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', BOB);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].title).toBe('Alice 作品');
    const sqls = mockQuery.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sqls).toMatch(/tenant_id\s*=\s*\$/);
  });

  it('POST /api/works 自动 SET tenant_id（防伪造）+ owner_id（审计）', async () => {
    mockTenantMember(TENANT_A);
    mockQuery.mockResolvedValueOnce({ rows: [ALICE_WORK] });

    const res = await request(app)
      .post('/api/works')
      .set('X-Feishu-User-Id', ALICE)
      .send({
        title: 'Alice 作品',
        content_type: 'video',
        body: 'A 的内容',
        tenant_id: TENANT_B, // 试图伪造
        owner_id: BOB,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(TENANT_A);
    expect(res.body.owner_id).toBe(ALICE);
    const insertCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).match(/INSERT\s+INTO\s+zenithjoy\.works/i)
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params).toContain(TENANT_A);
    expect(params).toContain(ALICE);
    expect(params).not.toContain(TENANT_B);
    expect(params).not.toContain(BOB);
  });

  it('GET /api/works/:id 跨 tenant 返回 404', async () => {
    mockTenantMember(TENANT_B);
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .get(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', 'ou_carol_003');

    expect(res.status).toBe(404);
  });

  it('PUT /api/works/:id 跨 tenant 返回 404', async () => {
    mockTenantMember(TENANT_B);
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .put(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', 'ou_carol_003')
      .send({ title: '篡改' });

    expect(res.status).toBe(404);
  });

  it('DELETE /api/works/:id 跨 tenant 返回 404', async () => {
    mockTenantMember(TENANT_B);
    mockQuery.mockResolvedValueOnce({ rows: [BOB_WORK] });

    const res = await request(app)
      .delete(`/api/works/${BOB_WORK.id}`)
      .set('X-Feishu-User-Id', 'ou_carol_003');

    expect(res.status).toBe(404);
  });

  it('super-admin X-Bypass-Tenant=true 返回全部作品（跨 tenant）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '2' }] })
      .mockResolvedValueOnce({ rows: [ALICE_WORK, CAROL_WORK] });

    const res = await request(app)
      .get('/api/works')
      .set('X-Feishu-User-Id', ADMIN)
      .set('X-Bypass-Tenant', 'true');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    const sqls = mockQuery.mock.calls.map((c) => String(c[0])).join('\n');
    expect(sqls).not.toMatch(/tenant_id\s*=\s*\$/);
  });
});
