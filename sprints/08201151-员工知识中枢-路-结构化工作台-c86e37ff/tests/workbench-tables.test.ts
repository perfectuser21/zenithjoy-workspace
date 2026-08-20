/**
 * S1 建表最小闭环 —— 建表落库带归属 / 八类字段 / 零运行时 DDL / 反枚举统一 404
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_tables / db_fields：真 INSERT 真 SELECT，不 stub DB 层；
 *   - 会话 → 成员行 → org_id 这一跳全程真跑。
 *
 * TDD Red：/api/knowledge/db/* 端点族与五表 migration 尚不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  EIGHT_FIELD_TYPES,
  type TwoTenantSeed,
} from './_workbench-fixture';

let seed: TwoTenantSeed;

async function zenithjoyTableList(seedRef: TwoTenantSeed): Promise<string[]> {
  const r = await seedRef.client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'zenithjoy' ORDER BY table_name"
  );
  return r.rows.map((x: { table_name: string }) => x.table_name);
}

beforeAll(async () => {
  seed = await seedTwoTenants('WB-TABLES');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S1 建表最小闭环 [BEHAVIOR]', () => {
  it('建表返 201 且 org_id 取自会话忽略请求体', async () => {
    const res = await createTable(seed.aliceCookie, `表-${seed.sfx}`, 'org', seed.orgBTenantId);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.table_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.data.org_id).toBe(seed.orgATenantId);
    // 禁用字段名不得出现（Response Schema 漂移守卫）
    for (const banned of ['tenant_id', 'is_private']) {
      expect(Object.keys(res.body.data)).not.toContain(banned);
    }
    const row = await seed.client.query(
      "SELECT org_id::text AS org_id, visibility FROM zenithjoy.db_tables WHERE id = $1 AND created_at > NOW() - interval '5 minutes'",
      [res.body.data.table_id]
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].org_id).toBe(seed.orgATenantId);
    expect(row.rows[0].visibility).toBe('org');
  });

  it('八类字段各一落 db_fields，名/类型/选项/顺序逐字回读', async () => {
    const created = await createTable(seed.aliceCookie, `八类-${seed.sfx}`, 'org');
    expect(created.status).toBe(201);
    const tableId = created.body.data.table_id;

    const rows = await seed.client.query(
      'SELECT name, field_type, options, display_order FROM zenithjoy.db_fields WHERE table_id = $1 ORDER BY display_order',
      [tableId]
    );
    expect(rows.rowCount).toBe(8);
    expect(rows.rows.map((r: { field_type: string }) => r.field_type)).toEqual([...EIGHT_FIELD_TYPES]);

    // 刷新（重新 GET）后逐字相同 —— 这是 PRD Golden Path 第 3 步的用户可观察输出
    const reread = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.aliceCookie);
    expect(reread.status).toBe(200);
    expect(reread.body.data.fields.map((f: { field_type: string }) => f.field_type)).toEqual([
      ...EIGHT_FIELD_TYPES,
    ]);
    expect(reread.body.data.fields.map((f: { name: string }) => f.name)).toEqual(
      EIGHT_FIELD_TYPES.map((t) => `字段-${t}`)
    );
    const selectField = reread.body.data.fields.find(
      (f: { field_type: string }) => f.field_type === 'single_select'
    );
    expect(selectField.options).toEqual(['甲', '乙']);
  });

  it('建表不产生运行时 DDL', async () => {
    const before = await zenithjoyTableList(seed);
    // 表名与字段名带对抗字符：必须作为数据值走绑定参数，永不进标识符位
    const res = await request(app)
      .post('/api/knowledge/db/tables')
      .set('Cookie', seed.aliceCookie)
      .send({
        name: `"; DROP TABLE db_rows; --`,
        visibility: 'org',
        fields: [{ name: '__proto__', field_type: 'text', options: [], display_order: 0 }],
      });
    expect(res.status).toBe(201);
    const after = await zenithjoyTableList(seed);
    expect(after).toEqual(before);
    // 表名原样作为数据值落库，不被截断也不被执行
    const row = await seed.client.query('SELECT name FROM zenithjoy.db_tables WHERE id = $1', [
      res.body.data.table_id,
    ]);
    expect(row.rows[0].name).toBe(`"; DROP TABLE db_rows; --`);
  });

  it('跨组织 GET 返 404 且与随机 id 逐字节相同', async () => {
    const created = await createTable(seed.aliceCookie, `跨企业-${seed.sfx}`, 'org');
    const tableId = created.body.data.table_id;

    // 丙是 B 企业员工：拿 A 企业真实存在的 id 与一个随机不存在的 id，两组响应必须一模一样
    const cross = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.carolCookie);
    const ghost = await request(app)
      .get('/api/knowledge/db/tables/00000000-0000-4000-8000-000000000000')
      .set('Cookie', seed.carolCookie);

    expect(cross.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    // timestamp 之外逐字节相同 —— 用 403/404 的差异即可枚举出他企业表 id
    const strip = (b: Record<string, unknown>) => JSON.stringify({ ...b, timestamp: undefined });
    expect(strip(cross.body)).toBe(strip(ghost.body));

    // B 企业列表里零 A 企业的表
    const list = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.carolCookie);
    expect(list.status).toBe(200);
    expect(list.body.data.tables.map((t: { table_id: string }) => t.table_id)).not.toContain(tableId);
  });

  it('开箱模板 ≥2 个，一键建表结构与模板声明逐字一致', async () => {
    const tpl = await request(app).get('/api/knowledge/db/templates').set('Cookie', seed.aliceCookie);
    expect(tpl.status).toBe(200);
    expect(tpl.body.data.templates.length).toBeGreaterThanOrEqual(2);

    const first = tpl.body.data.templates[0];
    const made = await request(app)
      .post('/api/knowledge/db/tables')
      .set('Cookie', seed.aliceCookie)
      .send({ name: `模板建-${seed.sfx}`, visibility: 'org', template_key: first.template_key });
    expect(made.status).toBe(201);
    const shape = (fs: Array<{ name: string; field_type: string; display_order: number }>) =>
      fs.map((f) => `${f.display_order}:${f.name}:${f.field_type}`);
    expect(shape(made.body.data.fields)).toEqual(shape(first.fields));
  });
});
