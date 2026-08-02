import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquisitionDispatchRouter } from '../../../apps/api/src/routes/acquisition-dispatch';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL 或 DATABASE_URL 必填：本测试禁止 mock DB');

const db = new Pool({ connectionString: databaseUrl });
const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter);
const tenantA = '00000000-0000-4000-8000-000000000a01';
const tenantB = '00000000-0000-4000-8000-000000000b02';

async function config(tenantId: string) {
  return (await db.query('SELECT * FROM zenithjoy.acquisition_config WHERE tenant_id=$1', [tenantId])).rows[0];
}

function expectIso8601(value: unknown) {
  expect(value).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
}

function expectSuccessSchema(body: Record<string, unknown>) {
  expect(Object.keys(body).sort()).toEqual(['data', 'success', 'timestamp']);
  expectIso8601(body.timestamp);
}

describe('acquisition effective config validation（真 HTTP + 真 Postgres）', () => {
  beforeAll(async () => {
    await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]]);
    await db.query('INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ($1,3,8),($2,11,12)', [tenantA, tenantB]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]]);
    await db.end();
  });

  it('真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await config(tenantA);
    const beforeB = await config(tenantB);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA).send({ keywords_per_round_min: 9 });
      expect(response.status, `attempt ${attempt}`).toBe(400);
      expect(response.body).toMatchObject({ success: false, error: { code: 'INVALID_CONFIG' } });
      expect(response.body.error.message).toEqual(expect.any(String));
      expect(response.body.error.message.length).toBeGreaterThan(0);
      expect(Object.keys(response.body).sort()).toEqual(['error', 'success', 'timestamp']);
      expectIso8601(response.body.timestamp);
      expect(await config(tenantA)).toEqual(beforeA);
      expect(await config(tenantB)).toEqual(beforeB);
    }
  });

  it('真 HTTP 对合并后无效的 max-only patch 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const beforeA = await config(tenantA);
    const beforeB = await config(tenantB);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA).send({ keywords_per_round_max: 2 });
      expect(response.status, `attempt ${attempt}`).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CONFIG');
      expect(response.body.error.message).toEqual(expect.any(String));
      expect(response.body.error.message.length).toBeGreaterThan(0);
      expect(Object.keys(response.body).sort()).toEqual(['error', 'success', 'timestamp']);
      expectIso8601(response.body.timestamp);
      expect(await config(tenantA)).toEqual(beforeA);
      expect(await config(tenantB)).toEqual(beforeB);
    }
  });

  it('有效部分、完整和相等边界更新继续成功且不串租户', async () => {
    const beforeB = await config(tenantB);
    const minOnly = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA).send({ keywords_per_round_min: 7 });
    expect(minOnly.status).toBe(200);
    expectSuccessSchema(minOnly.body);
    const maxOnly = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA).send({ keywords_per_round_max: 9 });
    expect(maxOnly.status).toBe(200);
    expectSuccessSchema(maxOnly.body);
    const equal = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA).send({ keywords_per_round_min: 7, keywords_per_round_max: 7 });
    expect(equal.status).toBe(200);
    expect(equal.body.data).toMatchObject({ keywords_per_round_min: 7, keywords_per_round_max: 7 });
    expectSuccessSchema(equal.body);
    expect(await config(tenantA)).toMatchObject({ keywords_per_round_min: 7, keywords_per_round_max: 7 });
    expect(await config(tenantB)).toEqual(beforeB);
  });
});
