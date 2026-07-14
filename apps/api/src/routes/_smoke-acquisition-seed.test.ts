/**
 * 安卓真机采集 smoke 自愈 seed 端点 — NODE_ENV + X-Smoke-Token 双门禁 + 幂等 upsert
 * pool 被 mock，纯逻辑/门禁行为测试（真 DB 幂等由真机 smoke step0 端到端验证）。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock DB pool：connect() 返回带 query/release 的 client
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockQuery, release: mockRelease }));
vi.mock('../db/connection', () => ({
  default: { connect: mockConnect, query: mockQuery },
}));

const { default: seedRouter } = await import('./_smoke-acquisition-seed');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/_smoke', seedRouter);
  return app;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SMOKE_TOKEN = process.env.SMOKE_TOKEN;
const TENANT = '455a8ca9-5f63-4286-83ce-c5cca04cfd58';
const AGENT = 'a7a7b36c-6d05-4653-8ba1-83c1553ef5c7';

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.SMOKE_TOKEN = ORIGINAL_SMOKE_TOKEN;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
  // licenses INSERT ... RETURNING id 需要 rows[0].id；其余查询忽略 rows
  mockQuery.mockResolvedValue({ rows: [{ id: '11111111-1111-1111-1111-111111111111' }] });
});

describe('_smoke-acquisition-seed [BEHAVIOR]', () => {
  it('NODE_ENV=production → 404', async () => {
    process.env.NODE_ENV = 'production';
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'any')
      .send({ tenant_id: TENANT });
    expect(r.status).toBe(404);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('缺 X-Smoke-Token → 403', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .send({ tenant_id: TENANT });
    expect(r.status).toBe(403);
  });

  it('缺 tenant_id → 400', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send({});
    expect(r.status).toBe(400);
  });

  it('正确 token + tenant_id → 200 + seeded；事务提交且释放连接', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send({ tenant_id: TENANT, agent_id: AGENT });
    expect(r.status).toBe(200);
    expect(r.body?.data?.seeded).toBe(true);
    expect(r.body?.data?.tenant_id).toBe(TENANT);
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes('BEGIN'))).toBe(true);
    expect(sql.some((s) => s.includes('zenithjoy.tenants'))).toBe(true);
    expect(sql.some((s) => s.includes('zenithjoy.licenses'))).toBe(true);
    expect(sql.some((s) => s.includes('zenithjoy.tenant_credits'))).toBe(true);
    expect(sql.some((s) => s.includes('zenithjoy.license_machines'))).toBe(true);
    expect(sql.some((s) => s.includes('COMMIT'))).toBe(true);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('幂等：重复调用仍 200', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const body = { tenant_id: TENANT, agent_id: AGENT };
    const app = makeApp();
    const r1 = await request(app)
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send(body);
    const r2 = await request(app)
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });

  it('无 agent_id → 跳过 license_machines 仍 200', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send({ tenant_id: TENANT });
    expect(r.status).toBe(200);
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes('zenithjoy.license_machines'))).toBe(false);
  });

  it('DB 抛错 → 500 + ROLLBACK + 释放连接', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('zenithjoy.tenants')) throw new Error('boom');
      return { rows: [{ id: 'x' }] };
    });
    const r = await request(makeApp())
      .post('/api/_smoke/acquisition-seed')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send({ tenant_id: TENANT });
    expect(r.status).toBe(500);
    const sql = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => s.includes('ROLLBACK'))).toBe(true);
    expect(mockRelease).toHaveBeenCalled();
  });
});
