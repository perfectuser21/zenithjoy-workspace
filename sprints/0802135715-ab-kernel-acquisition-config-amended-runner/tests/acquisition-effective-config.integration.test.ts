import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { acquisitionDispatchRouter } from '../../../apps/api/src/routes/acquisition-dispatch';
import pool from '../../../apps/api/src/db/connection';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter);

const tenantA = randomUUID();
const tenantB = randomUUID();

async function seed(tenantId: string, min: number, max: number) {
  await pool.query(
    `INSERT INTO zenithjoy.acquisition_config
       (tenant_id, keywords_per_round_min, keywords_per_round_max)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET
       keywords_per_round_min = EXCLUDED.keywords_per_round_min,
       keywords_per_round_max = EXCLUDED.keywords_per_round_max`,
    [tenantId, min, max],
  );
}

async function bounds(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT keywords_per_round_min, keywords_per_round_max
       FROM zenithjoy.acquisition_config
      WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0];
}

describe('Acquisition 合并后有效配置校验（真路由 + 真 Postgres）', () => {
  beforeAll(async () => {
    await seed(tenantA, 3, 5);
    await seed(tenantB, 7, 9);
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::uuid[])',
      [[tenantA, tenantB]],
    );
    await pool.end();
  });

  it('部分更新 min 与当前 max 合并后冲突时返回 INVALID_CONFIG 且两个租户均不变', async () => {
    const beforeA = await bounds(tenantA);
    const beforeB = await bounds(tenantB);

    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 10 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await bounds(tenantA)).toEqual(beforeA);
    expect(await bounds(tenantB)).toEqual(beforeB);
  });

  it('部分更新 max 与当前 min 合并后冲突时返回 INVALID_CONFIG 且两个租户均不变', async () => {
    await seed(tenantA, 7, 9);
    const beforeA = await bounds(tenantA);
    const beforeB = await bounds(tenantB);

    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_max: 5 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CONFIG');
    expect(await bounds(tenantA)).toEqual(beforeA);
    expect(await bounds(tenantB)).toEqual(beforeB);
  });

  it('合法部分更新、合法完整更新和等值边界仍持久化且不串租户', async () => {
    await seed(tenantA, 3, 5);
    const beforeB = await bounds(tenantB);

    const partial = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_max: 8 });
    expect(partial.status).toBe(200);
    expect(await bounds(tenantA)).toEqual({ keywords_per_round_min: 3, keywords_per_round_max: 8 });

    const complete = await request(app)
      .put('/api/acquisition/config')
      .set('X-Tenant-Id', tenantA)
      .send({ keywords_per_round_min: 6, keywords_per_round_max: 6 });
    expect(complete.status).toBe(200);
    expect(await bounds(tenantA)).toEqual({ keywords_per_round_min: 6, keywords_per_round_max: 6 });
    expect(await bounds(tenantB)).toEqual(beforeB);
  });
});
