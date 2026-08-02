import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../../apps/api/src/db/connection';
import { acquisitionDispatchRouter } from '../../../apps/api/src/routes/acquisition-dispatch';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter);

const tenantA = `contract-a-${randomUUID()}`;
const tenantB = `contract-b-${randomUUID()}`;

async function readBounds(tenantId: string) {
  const result = await db.query(
    `SELECT keywords_per_round_min, keywords_per_round_max
       FROM zenithjoy.acquisition_config WHERE tenant_id = $1`,
    [tenantId],
  );
  return result.rows[0];
}

describe('acquisition 配置按合并后的有效配置校验', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 必填：合同测试必须连接真实 Postgres');
    await db.query(
      `INSERT INTO zenithjoy.acquisition_config
         (tenant_id, keywords_per_round_min, keywords_per_round_max)
       VALUES ($1, 3, 5), ($2, 8, 12)`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]]);
  });

  it('仅更新 min 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const before = await readBounds(tenantA);
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 6 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await readBounds(tenantA)).toEqual(before);
  });

  it('仅更新 max 后有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化', async () => {
    const before = await readBounds(tenantB);
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantB)
      .send({ keywords_per_round_max: 7 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await readBounds(tenantB)).toEqual(before);
  });

  it('合法部分更新成功持久化并可读取且不改变另一租户', async () => {
    const tenantBBefore = await readBounds(tenantB);
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 4 });
    expect(response.status).toBe(200);
    expect(response.body.data.keywords_per_round_min).toBe(4);
    expect(await readBounds(tenantA)).toEqual({ keywords_per_round_min: 4, keywords_per_round_max: 5 });
    expect(await readBounds(tenantB)).toEqual(tenantBBefore);
  });

  it('合法完整更新与 min=max 等值边界成功持久化', async () => {
    const response = await request(app).put('/api/acquisition/config').set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 9, keywords_per_round_max: 9 });
    expect(response.status).toBe(200);
    expect(response.body.data.keywords_per_round_min).toBe(9);
    expect(response.body.data.keywords_per_round_max).toBe(9);
    expect(await readBounds(tenantA)).toEqual({ keywords_per_round_min: 9, keywords_per_round_max: 9 });
  });
});
