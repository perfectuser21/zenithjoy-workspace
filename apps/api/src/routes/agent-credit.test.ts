/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { agentCreditRouter } from './agent-credit';

vi.mock('../middleware/license-auth', () => ({
  licenseAuth: (req: any, res: any, next: any) => {
    const key = req.headers['x-license-key'];
    if (!key) {
      return res.status(401).json({ ok: false, code: 'INVALID_LICENSE', message: 'no license' });
    }
    if (key === 'no-tenant-license') {
      req.license = {};
    } else {
      req.license = { tenant_id: 'tenant-1' };
    }
    next();
  },
}));

vi.mock('../services/credits.service', () => {
  class InsufficientCreditsError extends Error {
    required: number;
    current: number;
    constructor(required: number, current: number) {
      super(`insufficient credits: required=${required} current=${current}`);
      this.name = 'InsufficientCreditsError';
      this.required = required;
      this.current = current;
    }
  }
  return {
    getBalance: vi.fn(),
    consume: vi.fn(),
    InsufficientCreditsError,
  };
});

import { getBalance, consume, InsufficientCreditsError } from '../services/credits.service';

const app = express();
app.use(express.json());
app.use('/api/agent/credit', agentCreditRouter);
app.use((_req, res) => res.status(404).json({ error: 'not found' }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/credit/balance', () => {
  it('401 缺少 license', async () => {
    const res = await request(app).get('/api/agent/credit/balance');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_LICENSE');
  });

  it('403 license 未关联租户', async () => {
    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'no-tenant-license');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_TENANT');
  });

  it('200 返回余额', async () => {
    (getBalance as any).mockResolvedValue({ balance: 500, total_recharged: 1000, total_consumed: 500 });
    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'valid-license');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.balance).toBe(500);
  });

  it('租户无记录时返回默认全 0', async () => {
    (getBalance as any).mockResolvedValue(null);
    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'valid-license');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ balance: 0, total_recharged: 0, total_consumed: 0 });
  });

  it('500 服务异常', async () => {
    (getBalance as any).mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .get('/api/agent/credit/balance')
      .set('x-license-key', 'valid-license');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('FETCH_FAILED');
  });
});

describe('POST /api/agent/credit/deduct', () => {
  it('401 缺少 license', async () => {
    const res = await request(app).post('/api/agent/credit/deduct').send({ amount: 1, reason: 'x' });
    expect(res.status).toBe(401);
  });

  it('400 amount 非法（非整数）', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 1.5, reason: 'keyword_search' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  it('400 amount 超出上限', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 2_000_000, reason: 'keyword_search' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  it('400 reason 缺失', async () => {
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REASON');
  });

  it('200 扣费成功', async () => {
    (consume as any).mockResolvedValue({ balance: 99, total_consumed: 1 });
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 1, reason: 'keyword_search' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.tenant_id).toBe('tenant-1');
    expect(res.body.data.balance).toBe(99);
  });

  it('402 余额不足', async () => {
    (consume as any).mockRejectedValue(new InsufficientCreditsError(10, 3));
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 10, reason: 'keyword_search' });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('INSUFFICIENT_CREDITS');
    expect(res.body.data).toEqual({ required: 10, current: 3 });
  });

  it('500 扣费服务异常', async () => {
    (consume as any).mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .post('/api/agent/credit/deduct')
      .set('x-license-key', 'valid-license')
      .send({ amount: 1, reason: 'keyword_search' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('DEDUCT_FAILED');
  });
});
