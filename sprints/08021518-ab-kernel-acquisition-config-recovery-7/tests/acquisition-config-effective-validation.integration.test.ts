import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { getConfig, upsertConfig } from '../../../apps/api/src/services/acquisition-dispatch';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL 或 DATABASE_URL 必填：本测试禁止 mock DB');

const db = new Pool({ connectionString: databaseUrl });
const tenantA = '00000000-0000-4000-8000-000000000a01';
const tenantB = '00000000-0000-4000-8000-000000000b02';

describe('acquisition 有效配置合并校验（真 Postgres）', () => {
  beforeAll(async () => {
    await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await db.query(
      `INSERT INTO zenithjoy.acquisition_config
         (tenant_id, keywords_per_round_min, keywords_per_round_max)
       VALUES ($1, 3, 8), ($2, 11, 12)`,
      [tenantA, tenantB],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB]]);
    await db.end();
  });

  it('只更新最小值且合并后倒置时拒绝并零持久化', async () => {
    const beforeA = await getConfig(db, tenantA);
    const beforeB = await getConfig(db, tenantB);

    await expect(upsertConfig(db, tenantA, { keywords_per_round_min: 9 }))
      .rejects.toMatchObject({ code: 'INVALID_CONFIG' });

    expect(await getConfig(db, tenantA)).toEqual(beforeA);
    expect(await getConfig(db, tenantB)).toEqual(beforeB);
  });

  it('有效部分、完整和相等边界更新继续持久化且不串租户', async () => {
    const beforeB = await getConfig(db, tenantB);
    await expect(upsertConfig(db, tenantA, { keywords_per_round_min: 7 }))
      .resolves.toMatchObject({ keywords_per_round_min: 7, keywords_per_round_max: 8 });
    await expect(upsertConfig(db, tenantA, { keywords_per_round_max: 9 }))
      .resolves.toMatchObject({ keywords_per_round_min: 7, keywords_per_round_max: 9 });
    await expect(upsertConfig(db, tenantA, { keywords_per_round_min: 6, keywords_per_round_max: 9 }))
      .resolves.toMatchObject({ keywords_per_round_min: 6, keywords_per_round_max: 9 });
    await expect(upsertConfig(db, tenantA, { keywords_per_round_min: 7, keywords_per_round_max: 7 }))
      .resolves.toMatchObject({ keywords_per_round_min: 7, keywords_per_round_max: 7 });
    expect(await getConfig(db, tenantB)).toEqual(beforeB);
  });
});
