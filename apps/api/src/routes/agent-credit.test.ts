/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { agentCreditRouter } from './agent-credit';

vi.mock('../middleware/license-auth', () => ({
  licenseAuth: (req: any, _res: any, next: any) => {
    const key = req.headers['x-license-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
    if (key === 'ZJ-VALID-KEY') {
      req.license = { tenant_id: 'tenant-test-01', license_key: key };
    } else if (key === 'ZJ-NO-TENANT') {
      req.license = {};
    }
    // else: no license set → 403 from handler
    next();
  },
}));

vi.mock('../services/credits.service', () => ({
  getBalance: vi.fn(),
  consume: vi.fn(),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    required: number;
    current: number;
    constructor(required: number, current: number) {
      super(`积分不足: 需要 ${required}，当前 ${current}`);
      this.required = required;
      this.current = current;
      this.name = 'InsufficientCreditsError';
    }
  },
}));

const app = express();
app.use(express.json());
app.use('/api/agent/credit', agentCreditRouter);

describe('GET /api/agent/credit/balance', () => {
  beforeEach(() => vi.resetAllMocks());

  it('有效 license → 200 + balance 数据', async () => {
    const { getBalance } = await import('../services/credits.service');
    (getBalance as any).mockResolvedValue({ balance: 500, total_recharged: 1000, total_consumed: 500 });

    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'ZJ-VALID-KEY');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.balance).toBe(500);
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('getBalance 返回 null → balance 默认 0', async () => {
    const { getBalance } = await import('../services/credits.service');
    (getBalance as any).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'ZJ-VALID-KEY');

    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(0);
  });

  it('license 无关联 tenant → 403 NO_TENANT', async () => {
    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'ZJ-NO-TENANT');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_TENANT');
  });

  it('DB 异常 → 500 FETCH_FAILED', async () => {
    const { getBalance } = await import('../services/credits.service');
    (getBalance as any).mockRejectedValue(new Error('db down'));

    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'ZJ-VALID-KEY');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('FETCH_FAILED');
  });
});

describe('POST /api/agent/credit/deduct', () => {
  beforeEach(() => vi.resetAllMocks());

  it('有效请求 → 200 + 扣减后余额', async () => {
    const { consume } = await import('../services/credits.service');
    (consume as any).mockResolvedValue({ balance: 490, total_recharged: 1000, total_consumed: 510 });

    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ amount: 10, reason: '关键词搜索' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.balance).toBe(490);
    expect(res.body.data.tenant_id).toBe('tenant-test-01');
  });

  it('amount 缺失 → 400 INVALID_AMOUNT', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ reason: '搜索' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  it('amount 为 0 → 400 INVALID_AMOUNT', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ amount: 0, reason: '搜索' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  it('reason 空字符串 → 400 INVALID_REASON', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ amount: 5, reason: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REASON');
  });

  it('积分不足 → 402 INSUFFICIENT_CREDITS', async () => {
    const { consume, InsufficientCreditsError } = await import('../services/credits.service');
    (consume as any).mockRejectedValue(new (InsufficientCreditsError as any)(10, 2));

    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ amount: 10, reason: '搜索' });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('INSUFFICIENT_CREDITS');
    expect(res.body.data.required).toBe(10);
    expect(res.body.data.current).toBe(2);
  });

  it('DB 异常 → 500 DEDUCT_FAILED', async () => {
    const { consume } = await import('../services/credits.service');
    (consume as any).mockRejectedValue(new Error('db error'));

    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'ZJ-VALID-KEY')
      .send({ amount: 5, reason: '搜索' });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('DEDUCT_FAILED');
  });
});
