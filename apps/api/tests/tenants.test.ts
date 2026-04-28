import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../src/db/connection';
const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

describe('POST /api/tenants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 without name', async () => {
    const res = await request(app).post('/api/tenants').send({});
    expect(res.status).toBe(400);
  });

  it('creates tenant and returns license key starting with ZJ-', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'tid-1', name: 'TestCo', license_key: 'ZJ-ABCD1234', plan: 'free',
        created_at: new Date().toISOString(),
      }],
    });
    const res = await request(app).post('/api/tenants').send({ name: 'TestCo' });
    expect(res.status).toBe(201);
    expect(res.body.tenant.license_key).toMatch(/^ZJ-/);
  });
});

describe('GET /api/tenants/:id/feishu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown tenant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/tenants/no-id/feishu');
    expect(res.status).toBe(404);
  });

  it('returns feishu config when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ feishu_app_id: 'app1', feishu_app_secret: 'sec1',
               feishu_bitable: 'bit1', feishu_table_crm: 'crm1', feishu_table_log: 'log1' }],
    });
    const res = await request(app).get('/api/tenants/tid-1/feishu');
    expect(res.status).toBe(200);
    expect(res.body.feishu.feishu_app_id).toBe('app1');
  });
});

describe('PUT /api/tenants/:id/feishu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for unknown tenant', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/api/tenants/no-id/feishu').send({});
    expect(res.status).toBe(404);
  });

  it('updates feishu config', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tid-1' }] });
    const res = await request(app).put('/api/tenants/tid-1/feishu').send({
      feishu_app_id: 'app1', feishu_app_secret: 'sec1',
      feishu_bitable: 'bit1', feishu_table_crm: 'crm1', feishu_table_log: 'log1',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
