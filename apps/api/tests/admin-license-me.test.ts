/**
 * Sprint A · WS1 — License 后端 /me + super-admin 守卫
 *
 * BEHAVIOR 覆盖（合同 sprints/sprint-a-license-ui/contract-dod-ws1.md）:
 *  - GET /api/admin/license/me 缺 X-Feishu-User-Id 返回 401
 *  - GET /api/admin/license/me 已知 customer_id 返回 license + machines
 *  - GET /api/admin/license/me 未绑定 customer_id 返回 license=null + machines=[]
 *  - POST /api/admin/license 非 admin 返回 403
 *  - POST /api/admin/license admin 创建 license 返回 200 + license_key
 *  - GET /api/admin/license admin 返回 license 列表
 *  - DELETE /api/admin/license/:id admin 吊销 license 返回 status=revoked
 */
import request from 'supertest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const ADMIN_FEISHU_ID = 'ou_admin_001';
const CUSTOMER_FEISHU_ID = 'ou_customer_alice';
const NON_ADMIN_FEISHU_ID = 'ou_random_bob';

const LICENSE_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  license_key: 'ZJ-M-ABCD1234',
  tier: 'matrix',
  max_machines: 3,
  customer_id: CUSTOMER_FEISHU_ID,
  customer_name: 'Alice',
  customer_email: 'alice@example.com',
  status: 'active',
  issued_at: '2026-04-28T00:00:00Z',
  expires_at: '2027-04-28T00:00:00Z',
  revoked_at: null,
  notes: null,
  created_at: '2026-04-28T00:00:00Z',
  updated_at: '2026-04-28T00:00:00Z',
};

const MACHINE_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  license_id: LICENSE_ROW.id,
  machine_id: 'mac-alice-01',
  agent_id: 'agent-mac-alice-01',
  hostname: 'alice-MBP',
  first_seen: '2026-04-28T00:00:00Z',
  last_seen: '2026-04-28T01:00:00Z',
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ADMIN_FEISHU_OPENIDS', ADMIN_FEISHU_ID);
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Sprint A WS1 — GET /api/admin/license/me [BEHAVIOR]', () => {
  it('GET /api/admin/license/me 缺 X-Feishu-User-Id 返回 401', async () => {
    const res = await request(app).get('/api/admin/license/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false });
  });

  it('GET /api/admin/license/me 已知 customer_id 返回 license + machines 数组', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [LICENSE_ROW] })
      .mockResolvedValueOnce({ rows: [MACHINE_ROW] });

    const res = await request(app)
      .get('/api/admin/license/me')
      .set('X-Feishu-User-Id', CUSTOMER_FEISHU_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.license).not.toBeNull();
    expect(res.body.data.license.id).toBe(LICENSE_ROW.id);
    expect(res.body.data.license.tier).toBe('matrix');
    expect(Array.isArray(res.body.data.machines)).toBe(true);
    expect(res.body.data.machines.length).toBe(1);
    expect(res.body.data.machines[0].hostname).toBe('alice-MBP');
  });

  it('GET /api/admin/license/me 未绑定 customer_id 返回 license=null + machines=[]', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/admin/license/me')
      .set('X-Feishu-User-Id', NON_ADMIN_FEISHU_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.license).toBeNull();
    expect(Array.isArray(res.body.data.machines)).toBe(true);
    expect(res.body.data.machines.length).toBe(0);
  });
});

describe('Sprint A WS1 — super-admin 鉴权保护 admin 操作 [BEHAVIOR]', () => {
  it('POST /api/admin/license 非 admin 返回 403', async () => {
    const res = await request(app)
      .post('/api/admin/license')
      .set('X-Feishu-User-Id', NON_ADMIN_FEISHU_ID)
      .send({ tier: 'basic', customer_email: 'bob@example.com', duration_days: 30 });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('POST /api/admin/license admin 创建 license 返回 200 + license_key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [LICENSE_ROW] });

    const res = await request(app)
      .post('/api/admin/license')
      .set('X-Feishu-User-Id', ADMIN_FEISHU_ID)
      .send({ tier: 'matrix', customer_email: 'alice@example.com', duration_days: 365 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.license_key).toBe('string');
    expect(res.body.data.license_key.length).toBeGreaterThan(8);
  });

  it('GET /api/admin/license admin 返回 license 列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [LICENSE_ROW] });

    const res = await request(app)
      .get('/api/admin/license')
      .set('X-Feishu-User-Id', ADMIN_FEISHU_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.licenses)).toBe(true);
    expect(res.body.data.licenses.length).toBe(1);
    expect(res.body.data.licenses[0].tier).toBe('matrix');
  });

  it('DELETE /api/admin/license/:id admin 吊销 license 返回 status=revoked', async () => {
    const REVOKED_ROW = { ...LICENSE_ROW, status: 'revoked', revoked_at: '2026-04-28T05:00:00Z' };
    mockQuery.mockResolvedValueOnce({ rows: [REVOKED_ROW] });

    const res = await request(app)
      .delete(`/api/admin/license/${LICENSE_ROW.id}`)
      .set('X-Feishu-User-Id', ADMIN_FEISHU_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('revoked');
  });
});
