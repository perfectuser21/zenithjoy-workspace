/**
 * G1 / J7 段①② —— 旧 /api/fields 四端点挂鉴权 + field_definitions 加 tenant_id 隔离
 *
 * 判据现状（origin/main @ bdebf9e4）：四端点无任何鉴权，不带身份也返 2xx（洞记 issue 1ae57f1a）。
 * 本文件的第一个用例**现在就是红的**，转绿即段① 完成。
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - fields.service ↔ zenithjoy.field_definitions：真 Postgres 双租户种子验互不串，
 *     不 stub service 层（stub 出来的邻居永远配合，真表才会翻脸）。
 *
 * 隔离列口径：旧表走 works 家族的 **tenant_id**（合同 G1 逐字裁定：两表并存不合并），
 * 路③ 新表才是 org_id —— 列名写错等于中间件挂上去也过滤不到。
 *
 * 正向对照改哪一列：`field_definitions` **没有 `label` 列**（`\d zenithjoy.field_definitions` 实测列集
 * = id/field_name/field_type/options/display_order/is_visible/created_at/updated_at；建表 migration
 * `20260210_000000_create_works_tables.sql:66-75` 同；`models/schemas.ts:30-38` 的 `createFieldSchema`
 * 也不含它，zod 会把 `{label:x}` strip 成 `{}`——PUT 返 2xx 却什么都没改）。本刀 PRD J7 段② 只要求加
 * `tenant_id`，不许为了转绿去造一个 PRD 没要求的列。故正向对照走既有可更新列 **`field_name`**
 * （`VARCHAR(100) NOT NULL`，在 `createFieldSchema` 内，`.partial()` 后可单独 PUT，
 * `fields.service.ts:73` 的动态 UPDATE 认它）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import { seedTwoTenants, cleanupSeed, type TwoTenantSeed } from './_workbench-fixture';

let seed: TwoTenantSeed;
let orgAFieldId = '';
let orgBFieldId = '';

beforeAll(async () => {
  seed = await seedTwoTenants('WB-FIELDS');
  // field_definitions 的 NOT NULL 无默认列只有 field_name / field_type，两者都给；
  // tenant_id 是本刀段② 新增列（现在不存在 → 这条 INSERT 报错即必红原因之一）。
  const mk = async (name: string, tenantId: string): Promise<string> => {
    const r = await seed.client.query(
      `INSERT INTO zenithjoy.field_definitions (field_name, field_type, tenant_id)
       VALUES ($1, 'text', $2) RETURNING id`,
      [name, tenantId]
    );
    return r.rows[0].id as string;
  };
  // 两家各种一行：只种 B 的话「一律返空/一律 403」的实现会全绿（正向无从对照）。
  orgAFieldId = await mk(`legacy_a_${seed.sfx}`, seed.orgATenantId);
  orgBFieldId = await mk(`legacy_b_${seed.sfx}`, seed.orgBTenantId);
});

afterAll(async () => {
  if (seed?.client) {
    await seed.client
      .query('DELETE FROM zenithjoy.field_definitions WHERE tenant_id = ANY($1::uuid[])', [
        [seed.orgATenantId, seed.orgBTenantId],
      ])
      .catch(() => undefined);
  }
  await cleanupSeed(seed);
});

describe('G1 旧 /api/fields 处置 [BEHAVIOR]', () => {
  it('无身份调 /api/fields 四端点均返 401', async () => {
    const calls = [
      request(app).get('/api/fields'),
      request(app).post('/api/fields').send({ field_name: `x_${seed.sfx}`, field_type: 'text' }),
      request(app).put(`/api/fields/${orgBFieldId}`).send({ field_name: `y_${seed.sfx}` }),
      request(app).delete(`/api/fields/${orgBFieldId}`),
    ];
    const results = await Promise.all(calls);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    // 未鉴权的 DELETE 绝不许已经把行删了
    const still = await seed.client.query('SELECT count(*)::int AS c FROM zenithjoy.field_definitions WHERE id = $1', [
      orgBFieldId,
    ]);
    expect(still.rows[0].c).toBe(1);
  });

  it('A 企业身份读不到 B 企业 field_definitions 且能读到自己那一行', async () => {
    const res = await request(app).get('/api/fields').set('Cookie', seed.aliceCookie);
    expect(res.status).toBe(200);
    const ids = (Array.isArray(res.body) ? res.body : res.body.data).map(
      (f: { id: string }) => f.id
    );
    // 反向：读不到 B 的
    expect(ids).not.toContain(orgBFieldId);
    // 正向对照：必须读得到 A 自己的。缺这一条，「一律返空数组」的实现会全绿而
    // dashboard /works/fields 当场瘫痪 —— PR#1675→#1676 那次往返的形状。
    expect(ids).toContain(orgAFieldId);
  });

  it('A 企业身份能改自己那一行且 field_name 真落库（正向对照）', async () => {
    const newName = `legacy_a_renamed_${seed.sfx}`;
    const put = await request(app)
      .put(`/api/fields/${orgAFieldId}`)
      .set('Cookie', seed.aliceCookie)
      .send({ field_name: newName });
    expect(put.status).toBeGreaterThanOrEqual(200);
    expect(put.status).toBeLessThan(300);

    const row = await seed.client.query(
      'SELECT field_name FROM zenithjoy.field_definitions WHERE id = $1',
      [orgAFieldId]
    );
    expect(row.rows[0].field_name).toBe(newName);
  });

  it('A 企业身份改不动 B 企业 field_definitions 且 B 行未变', async () => {
    const before = await seed.client.query(
      'SELECT md5(row(field_name, field_type, display_order, is_visible, tenant_id)::text) AS h FROM zenithjoy.field_definitions WHERE id = $1',
      [orgBFieldId]
    );

    const put = await request(app)
      .put(`/api/fields/${orgBFieldId}`)
      .set('Cookie', seed.aliceCookie)
      .send({ field_name: `legacy_b_hacked_${seed.sfx}` });
    expect([403, 404]).toContain(put.status);

    const del = await request(app)
      .delete(`/api/fields/${orgBFieldId}`)
      .set('Cookie', seed.aliceCookie);
    expect([403, 404]).toContain(del.status);

    const after = await seed.client.query(
      'SELECT md5(row(field_name, field_type, display_order, is_visible, tenant_id)::text) AS h FROM zenithjoy.field_definitions WHERE id = $1',
      [orgBFieldId]
    );
    expect(after.rowCount).toBe(1);
    expect(after.rows[0].h).toBe(before.rows[0].h);
  });

  it('field_definitions.tenant_id 列存在且已回填（段② migration 落地）', async () => {
    const col = await seed.client.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema = 'zenithjoy' AND table_name = 'field_definitions' AND column_name = 'tenant_id'"
    );
    expect(col.rowCount).toBe(1);
    const nulls = await seed.client.query(
      'SELECT count(*)::int AS c FROM zenithjoy.field_definitions WHERE tenant_id IS NULL'
    );
    expect(nulls.rows[0].c).toBe(0);
  });
});
