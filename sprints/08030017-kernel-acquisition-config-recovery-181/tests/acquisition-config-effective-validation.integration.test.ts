import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

let app: Express;
let db: Pool;
const tenantA = `contract-a-${randomUUID()}`;
const tenantB = `contract-b-${randomUUID()}`;

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

describe('acquisition 配置按租户当前有效配置校验', () => {
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
      await db.query(
        'DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])',
        [[tenantA, tenantB]],
      );
      await db.end();
    }
  });

  it('PUT 仅提高 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await readConfig(tenantA);
    const beforeB = await readConfig(tenantB);
    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 11 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await readConfig(tenantA)).toEqual(beforeA);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('PATCH 仅降低 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await readConfig(tenantA);
    const beforeB = await readConfig(tenantB);
    const response = await request(app)
      .patch('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_max: 2 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await readConfig(tenantA)).toEqual(beforeA);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('合法部分更新成功持久化且只改变请求字段并保持双租户隔离', async () => {
    const beforeB = await readConfig(tenantB);
    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 8 });
    expect(response.status).toBe(200);
    expect(response.body.data.keywords_per_round_min).toBe(8);
    const afterA = await readConfig(tenantA);
    expect(afterA.keywords_per_round_min).toBe(8);
    expect(afterA.keywords_per_round_max).toBe(10);
    expect(await readConfig(tenantB)).toEqual(beforeB);
  });

  it('合法完整更新与 min=max 等值边界成功持久化并可读回', async () => {
    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 12, keywords_per_round_max: 12 });
    expect(response.status).toBe(200);
    expect(response.body.data.keywords_per_round_min).toBe(12);
    expect(response.body.data.keywords_per_round_max).toBe(12);
    const afterA = await readConfig(tenantA);
    expect(afterA.keywords_per_round_min).toBe(12);
    expect(afterA.keywords_per_round_max).toBe(12);
  });

  it('后续请求按实际可见当前配置校验且非法请求不更新时间', async () => {
    await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 9, keywords_per_round_max: 10 })
      .expect(200);
    const before = await readConfig(tenantA);
    const response = await request(app)
      .patch('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_max: 8 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await readConfig(tenantA)).toEqual(before);
  });
});
