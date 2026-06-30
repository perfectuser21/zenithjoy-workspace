/**
 * Regression: POST /collect/expand 手动关键词无需飞书绑定
 *
 * 根因（decision 96f0ebd2）：manual_keywords 非空时应直接返回，
 * 不走飞书校验；旧代码先校验飞书导致手动输入被 FEISHU_NOT_BOUND 拦死。
 *
 * commit-1 RED：无飞书绑定 + manual_keywords → 当前返 400 FEISHU_NOT_BOUND（错）
 * commit-2 GREEN：提前判断 manual_keywords → 直接返 200
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db：tenant_feishu_bindings 查询返回空（未绑飞书）
vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));

// Mock tenant-context：X-Tenant-Id header 直接设为 tenantId
vi.mock('../../src/middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: () => void) => {
    const t = req.header('X-Tenant-Id');
    if (t) req.tenantId = String(t).trim();
    next();
  },
}));

const { acquisitionRouter } = await import('../../src/routes/acquisition');

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);

const TENANT = 'aaaaaaaa-1111-2222-3333-000000000000';

describe('regression: collect/expand manual_keywords 无需飞书绑定', () => {
  beforeEach(() => vi.clearAllMocks());

  it('【RED→GREEN】manual_keywords 非空 + 无飞书绑定 → 200 直接返回关键词', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/expand')
      .set('X-Tenant-Id', TENANT)
      .send({ manual_keywords: ['医美', '护肤'] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.keywords).toEqual([
      { word: '医美', source: 'manual' },
      { word: '护肤', source: 'manual' },
    ]);
  });

  it('【保持不变】无 manual_keywords + 无飞书绑定 → 400 FEISHU_NOT_BOUND', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/expand')
      .set('X-Tenant-Id', TENANT)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FEISHU_NOT_BOUND');
  });

  it('【保持不变】manual_keywords 空数组 + 无飞书绑定 → 400 FEISHU_NOT_BOUND', async () => {
    const res = await request(app)
      .post('/api/acquisition/collect/expand')
      .set('X-Tenant-Id', TENANT)
      .send({ manual_keywords: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FEISHU_NOT_BOUND');
  });
});
