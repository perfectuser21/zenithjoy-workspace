import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';

let app: Express;
let db: Pool;
const tenantA = `contract-a-${randomUUID()}`;
const tenantB = `contract-b-${randomUUID()}`;

const PUT_DATA_KEYS = [
  'burner_count', 'collect_active_end', 'collect_active_start', 'collect_rounds_per_day',
  'cookie_check_interval_hours', 'dm_active_end', 'dm_active_start', 'dm_interval_max_sec',
  'dm_interval_min_sec', 'dm_message', 'dm_per_day', 'dm_per_hour',
  'keywords_per_round_max', 'keywords_per_round_min', 'nurture_per_day_max',
  'nurture_per_day_min', 'tenant_id',
].sort();

function configureDatabaseFromDbUrl(): void {
  const raw = process.env.DB_URL;
  if (!raw) throw new Error('DB_URL 必填：合同测试禁止使用隐式数据库默认值');
  const url = new URL(raw);
  process.env.DATABASE_HOST = url.hostname;
  process.env.DATABASE_PORT = url.port || '5432';
  process.env.DATABASE_NAME = decodeURIComponent(url.pathname.replace(/^\//, ''));
  process.env.DATABASE_USER = decodeURIComponent(url.username);
  process.env.DATABASE_PASSWORD = decodeURIComponent(url.password);
}

async function readConfig(tenantId: string): Promise<Record<string, unknown>> {
  const result = await db.query(
    'SELECT * FROM zenithjoy.acquisition_config WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0];
}

function expectInvalidConfig(response: request.Response): void {
  expect(response.status).toBe(400);
  expect(Object.keys(response.body).sort()).toEqual(['error', 'success', 'timestamp']);
  expect(response.body.success).toBe(false);
  expect(Object.keys(response.body.error).sort()).toEqual(['code', 'message']);
  expect(response.body.error.code).toBe('INVALID_CONFIG');
  expect(typeof response.body.error.message).toBe('string');
  expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  expect(response.body).not.toHaveProperty('result');
  expect(response.body).not.toHaveProperty('min');
  expect(response.body).not.toHaveProperty('max');
}

function expectPutSuccess(response: request.Response, expectedTenant: string): void {
  expect(response.status).toBe(200);
  expect(Object.keys(response.body).sort()).toEqual(['data', 'success', 'timestamp']);
  expect(response.body.success).toBe(true);
  expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  expect(Object.keys(response.body.data).sort()).toEqual(PUT_DATA_KEYS);
  expect(response.body.data.tenant_id).toBe(expectedTenant);
  for (const key of PUT_DATA_KEYS.filter((key) => !['tenant_id', 'dm_message', 'collect_active_start', 'collect_active_end', 'dm_active_start', 'dm_active_end'].includes(key))) {
    expect(typeof response.body.data[key]).toBe('number');
  }
  expect(response.body).not.toHaveProperty('result');
  expect(response.body.data).not.toHaveProperty('min');
  expect(response.body.data).not.toHaveProperty('max');
}

describe('acquisition 配置按租户当前有效配置原子校验', () => {
  beforeAll(async () => {
    configureDatabaseFromDbUrl();
    const [{ default: pool }, dispatchModule, acquisitionModule] = await Promise.all([
      import('../../../apps/api/src/db/connection'),
      import('../../../apps/api/src/routes/acquisition-dispatch'),
      import('../../../apps/api/src/routes/acquisition'),
    ]);
    db = pool;
    app = express();
    app.use(express.json());
    app.use('/api/acquisition', dispatchModule.acquisitionDispatchRouter);
    app.use('/api/acquisition', acquisitionModule.acquisitionRouter);
    await db.query(
      `INSERT INTO zenithjoy.acquisition_config
         (tenant_id, keywords_per_round_min, keywords_per_round_max, dm_per_day)
       VALUES ($1, 3, 10, 30), ($2, 2, 8, 30)`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]]);
      await db.end();
    }
  });

  it('PUT 仅提高 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await readConfig(tenantA);
    const beforeB = await readConfig(tenantB);
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 11 });
    expectInvalidConfig(response);
    expect(await readConfig(tenantA)).toEqual(beforeA);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('PATCH 仅降低 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await readConfig(tenantA);
    const beforeB = await readConfig(tenantB);
    const response = await request(app).patch('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_max: 2 });
    expectInvalidConfig(response);
    expect(await readConfig(tenantA)).toEqual(beforeA);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('合法部分 PATCH 成功且只改变请求字段并保持完整响应 schema 与双租户隔离', async () => {
    const beforeB = await readConfig(tenantB);
    const response = await request(app).patch('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 8 });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['data', 'success', 'timestamp']);
    expect(response.body.success).toBe(true);
    expect(Object.keys(response.body.data).sort()).toEqual([...PUT_DATA_KEYS, 'target_profile_desc'].sort());
    expect(response.body.data.keywords_per_round_min).toBe(8);
    expect(response.body.data.keywords_per_round_max).toBe(10);
    expect(response.body.data.target_profile_desc).toBeNull();
    expect((await readConfig(tenantA)).keywords_per_round_max).toBe(10);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('合法完整 PUT 与 min=max 等值边界成功持久化并可读回', async () => {
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 12, keywords_per_round_max: 12 });
    expectPutSuccess(response, tenantA);
    expect(response.body.data.keywords_per_round_min).toBe(12);
    expect(response.body.data.keywords_per_round_max).toBe(12);
    const afterA = await readConfig(tenantA);
    expect(afterA.keywords_per_round_min).toBe(12);
    expect(afterA.keywords_per_round_max).toBe(12);
  });

  it('未涉及上下界的合法部分 PUT 不被误拒且只改变请求字段', async () => {
    const before = await readConfig(tenantA);
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ dm_per_day: 31 });
    expectPutSuccess(response, tenantA);
    const after = await readConfig(tenantA);
    expect(after.dm_per_day).toBe(31);
    expect(after.keywords_per_round_min).toBe(before.keywords_per_round_min);
    expect(after.keywords_per_round_max).toBe(before.keywords_per_round_max);
  });

  it('并发部分更新按锁后实际可见配置原子校验且最终 min<=max', async () => {
    await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 3, keywords_per_round_max: 10 }).expect(200);
    const blocker: PoolClient = await db.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT tenant_id FROM zenithjoy.acquisition_config WHERE tenant_id = $1 FOR UPDATE', [tenantA]);
    try {
      const raiseMin = request(app).patch('/api/acquisition/config').set('X-Tenant-Id', tenantA)
        .send({ keywords_per_round_min: 9 });
      const lowerMax = request(app).patch('/api/acquisition/config').set('X-Tenant-Id', tenantA)
        .send({ keywords_per_round_max: 8 });
      const pending = Promise.all([raiseMin, lowerMax]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await blocker.query('COMMIT');
      const responses = await pending;
      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      expectInvalidConfig(responses.find((response) => response.status === 400)!);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
    const finalA = await readConfig(tenantA);
    expect(Number(finalA.keywords_per_round_min)).toBeLessThanOrEqual(Number(finalA.keywords_per_round_max));
    expect((await readConfig(tenantB)).keywords_per_round_max).toBe(8);
  });
});
