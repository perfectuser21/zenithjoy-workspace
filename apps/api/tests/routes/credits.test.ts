/**
 * Credits 路由测试 — PR-C
 *
 * 端点：
 *   GET  /api/credits/balance        tenantContext
 *   GET  /api/credits/transactions   tenantContext
 *   POST /api/credits/recharge       superAdminGuard
 */
import request from 'supertest';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';
import { auth } from '../../src/auth';

vi.mock('../../src/db/connection', () => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(),
      end: vi.fn(),
      connect: vi.fn(async () => client),
      __client: client,
    },
  };
});

vi.mock('../../src/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClient = (pool as any).__client as {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  process.env.ADMIN_FEISHU_OPENIDS = 'ou_admin_test';
  mockGetSession.mockResolvedValue(null);
});

afterEach(() => {
  delete process.env.ADMIN_FEISHU_OPENIDS;
});

describe('GET /api/credits/balance', () => {
  it('缺鉴权 → 401', async () => {
    const res = await request(app).get('/api/credits/balance');
    expect(res.status).toBe(401);
  });

  it('已登录 tenant 用户 → 200 + balance', async () => {
    // tenantContext: tenant_members lookup
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT_A, role: 'owner' }],
    });
    // getBalance
    mockQuery.mockResolvedValueOnce({
      rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }],
    });
    const res = await request(app)
      .get('/api/credits/balance')
      .set('X-Feishu-User-Id', 'ou_user_a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.balance).toBe(100);
    expect(res.body.data.total_recharged).toBe(100);
  });

  it('tenant 还没有 credits 行 → 默认 0/0/0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT_A, role: 'owner' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getBalance → null
    const res = await request(app)
      .get('/api/credits/balance')
      .set('X-Feishu-User-Id', 'ou_user_a');
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(0);
    expect(res.body.data.total_recharged).toBe(0);
    expect(res.body.data.total_consumed).toBe(0);
  });
});

describe('GET /api/credits/transactions', () => {
  it('缺鉴权 → 401', async () => {
    const res = await request(app).get('/api/credits/transactions');
    expect(res.status).toBe(401);
  });

  it('已登录 → 200 + 倒序记录', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT_A, role: 'owner' }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 't2', tenant_id: TENANT_A, amount: -5, reason: 'ai_writing', metadata: null, created_at: '2026-04-29T10:00:00Z' },
        { id: 't1', tenant_id: TENANT_A, amount: 100, reason: 'initial_grant', metadata: null, created_at: '2026-04-29T09:00:00Z' },
      ],
    });
    const res = await request(app)
      .get('/api/credits/transactions?limit=10')
      .set('X-Feishu-User-Id', 'ou_user_a');
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toHaveLength(2);
    expect(res.body.data.transactions[0].id).toBe('t2');
  });
});

describe('POST /api/credits/recharge', () => {
  it('非超管 → 403', async () => {
    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_random_user')
      .send({ tenant_id: TENANT_A, amount: 50, reason: 'recharge' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('超管 → 200 + 新 balance（事务路径）', async () => {
    // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // upsert tenant_credits
    mockClient.query.mockResolvedValueOnce({
      rows: [{ balance: 150, total_recharged: 150, total_consumed: 0 }],
    });
    // insert tx
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] });
    // COMMIT
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_admin_test')
      .send({ tenant_id: TENANT_A, amount: 50, reason: 'recharge' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.balance).toBe(150);
  });

  it('amount 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_admin_test')
      .send({ tenant_id: TENANT_A, reason: 'recharge' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT');
  });

  it('amount <= 0 → 400', async () => {
    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_admin_test')
      .send({ tenant_id: TENANT_A, amount: 0, reason: 'recharge' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AMOUNT');
  });

  it('tenant_id 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_admin_test')
      .send({ amount: 50, reason: 'recharge' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TENANT_ID');
  });

  it('reason 缺失 → 400', async () => {
    const res = await request(app)
      .post('/api/credits/recharge')
      .set('X-Feishu-User-Id', 'ou_admin_test')
      .send({ tenant_id: TENANT_A, amount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REASON');
  });
});
