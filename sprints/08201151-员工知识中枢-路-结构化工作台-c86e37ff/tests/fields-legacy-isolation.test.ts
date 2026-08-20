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
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import { seedTwoTenants, cleanupSeed, type TwoTenantSeed } from './_workbench-fixture';

let seed: TwoTenantSeed;
let orgBFieldId = '';

beforeAll(async () => {
  seed = await seedTwoTenants('WB-FIELDS');
  const r = await seed.client.query(
    `INSERT INTO zenithjoy.field_definitions (field_name, field_type, label, tenant_id)
     VALUES ($1, 'text', $2, $3) RETURNING id`,
    [`legacy_b_${seed.sfx}`, `B企业字段-${seed.sfx}`, seed.orgBTenantId]
  );
  orgBFieldId = r.rows[0].id;
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
      request(app).post('/api/fields').send({ field_name: `x_${seed.sfx}`, field_type: 'text', label: 'x' }),
      request(app).put(`/api/fields/${orgBFieldId}`).send({ label: 'y' }),
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

  it('A 企业身份读不到 B 企业 field_definitions', async () => {
    const res = await request(app).get('/api/fields').set('Cookie', seed.aliceCookie);
    expect(res.status).toBe(200);
    const ids = (Array.isArray(res.body) ? res.body : res.body.data).map(
      (f: { id: string }) => f.id
    );
    expect(ids).not.toContain(orgBFieldId);

    const direct = await request(app)
      .get(`/api/fields/${orgBFieldId}`)
      .set('Cookie', seed.aliceCookie);
    expect([403, 404]).toContain(direct.status);
  });

  it('A 企业身份改不动 B 企业 field_definitions 且 B 行未变', async () => {
    const before = await seed.client.query(
      'SELECT md5(row(field_name, field_type, label, tenant_id)::text) AS h FROM zenithjoy.field_definitions WHERE id = $1',
      [orgBFieldId]
    );

    const put = await request(app)
      .put(`/api/fields/${orgBFieldId}`)
      .set('Cookie', seed.aliceCookie)
      .send({ label: '被越权改了' });
    expect([403, 404]).toContain(put.status);

    const del = await request(app)
      .delete(`/api/fields/${orgBFieldId}`)
      .set('Cookie', seed.aliceCookie);
    expect([403, 404]).toContain(del.status);

    const after = await seed.client.query(
      'SELECT md5(row(field_name, field_type, label, tenant_id)::text) AS h FROM zenithjoy.field_definitions WHERE id = $1',
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
