import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

vi.mock('../src/services/credits.service', () => ({
  getBalance: vi.fn(),
  recharge: vi.fn(),
  listTransactions: vi.fn(),
}));

import { getBalance, recharge, listTransactions } from '../src/services/credits.service';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetBalance = getBalance as ReturnType<typeof vi.fn>;
const mockRecharge = recharge as ReturnType<typeof vi.fn>;
const mockListTx = listTransactions as ReturnType<typeof vi.fn>;

const INTERNAL_TOKEN = 'test-internal-token';
const TEST_USER = 'ou_credits_test_001';
const TEST_TENANT_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff'; // valid hex UUID

describe('Credits API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', INTERNAL_TOKEN);
    // tenantContext middleware reads tenant_members table
    mockQuery.mockResolvedValue({ rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }] });
  });

  describe('GET /api/credits/balance', () => {
    it('returns balance for authenticated tenant', async () => {
      mockGetBalance.mockResolvedValueOnce({
        balance: 100,
        total_recharged: 200,
        total_consumed: 100,
      });
      const res = await request(app)
        .get('/api/credits/balance')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('balance');
    });

    it('returns zero balance when tenant has no credits row', async () => {
      mockGetBalance.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/api/credits/balance')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.data.balance).toBe(0);
    });
  });

  describe('GET /api/credits/transactions', () => {
    it('returns transaction list', async () => {
      const txRow = { id: 'tx-1', amount: 50, type: 'recharge', created_at: '2026-01-01T00:00:00Z' };
      mockListTx.mockResolvedValueOnce([txRow]);
      const res = await request(app)
        .get('/api/credits/transactions')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // route returns { data: { transactions: [...], total: n } }
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
    });

    it('returns empty list when no transactions', async () => {
      mockListTx.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/credits/transactions')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });
  });

  describe('POST /api/credits/recharge (superAdminGuard)', () => {
    it('recharges tenant credits with internal token', async () => {
      mockRecharge.mockResolvedValueOnce({ balance_after: 600 });
      const res = await request(app)
        .post('/api/credits/recharge')
        .set('X-Internal-Token', INTERNAL_TOKEN)
        .send({ tenant_id: TEST_TENANT_ID, amount: 500, reason: 'smoke test top-up' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 403 without admin auth', async () => {
      const res = await request(app)
        .post('/api/credits/recharge')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ tenant_id: TEST_TENANT_ID, amount: 500, reason: 'test' });
      expect(res.status).toBe(403);
    });

    it('returns 400 for missing reason', async () => {
      const res = await request(app)
        .post('/api/credits/recharge')
        .set('X-Internal-Token', INTERNAL_TOKEN)
        .send({ tenant_id: TEST_TENANT_ID, amount: 500 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing amount', async () => {
      const res = await request(app)
        .post('/api/credits/recharge')
        .set('X-Internal-Token', INTERNAL_TOKEN)
        .send({ tenant_id: TEST_TENANT_ID });
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-positive amount', async () => {
      const res = await request(app)
        .post('/api/credits/recharge')
        .set('X-Internal-Token', INTERNAL_TOKEN)
        .send({ tenant_id: TEST_TENANT_ID, amount: 0 });
      expect(res.status).toBe(400);
    });
  });
});
