/**
 * S2 行 CRUD 与 8 类字段校验 —— 行落 db_rows.data JSONB（key = 稳定 field_id）
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_rows：真 INSERT 真 SELECT，不 stub DB 层；
 *   - 会话 → orgId → 行归属这一跳全程真跑。
 *
 * TDD Red：`/api/knowledge/db/tables/:id/rows` 与 `/rows/:id` 端点族、`db_rows.version` 列
 * 在 origin/main 上都不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createRow,
  listRows,
  patchRow,
  fieldIdOf,
  EIGHT_FIELD_TYPES,
  type TwoTenantSeed,
} from './_rows-fixture';
import request from 'supertest';
import app from '../../../apps/api/src/app';

let seed: TwoTenantSeed;
let tableId: string;

/** 八类字段各给一个合法值（与合同「字段类型校验表」逐字对应） */
function legalValueFor(fieldType: string): unknown {
  switch (fieldType) {
    case 'text':
      return '一行文本';
    case 'long_text':
      return '第一行\n第二行';
    case 'number':
      return 42;
    case 'date':
      return '2026-08-20';
    case 'single_select':
      return '甲';
    case 'multi_select':
      return ['甲', '乙'];
    case 'person':
      return seed.bobOpenId;
    case 'url':
      return 'https://example.com/a';
    default:
      throw new Error(`未登记的字段类型：${fieldType}`);
  }
}

beforeAll(async () => {
  seed = await seedTwoTenants('WB-ROWS');
  const res = await createTable(seed.aliceCookie, `行表-${seed.sfx}`, 'org');
  tableId = res.body?.data?.table_id;
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S2 行 CRUD [BEHAVIOR]', () => {
  it('建行返 201 且 version 为 1', async () => {
    const res = await createRow(seed.aliceCookie, tableId);
    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(1);
    expect(typeof res.body.data.row_id).toBe('string');
    expect(res.body.data.data).toEqual({});

    const db = await seed.client.query(
      'SELECT org_id::text AS org_id, version, deleted_at FROM zenithjoy.db_rows WHERE id = $1',
      [res.body.data.row_id]
    );
    expect(db.rowCount).toBe(1);
    // 归属只来自会话：建行请求体里一个 org_id 都没有，库里却必须挂到甲所在的 A 企业
    expect(db.rows[0].org_id).toBe(seed.orgATenantId);
    expect(db.rows[0].deleted_at).toBeNull();
  });

  it('空表列行返零行且带 total 与 row_limit', async () => {
    const fresh = await createTable(seed.aliceCookie, `空表-${seed.sfx}`, 'org');
    const res = await listRows(seed.aliceCookie, fresh.body.data.table_id);
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([]);
    expect(res.body.data.total).toBe(0);
    // 上限由服务端下发，前端据此硬拦——写死在前端即违反 INV「禁写死环境假设值」
    expect(typeof res.body.data.row_limit).toBe('number');
  });

  it('八类字段各改一次逐字落库', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    let version = created.body.data.version;
    const expected: Record<string, unknown> = {};

    for (const fieldType of EIGHT_FIELD_TYPES) {
      const fieldId = await fieldIdOf(seed.aliceCookie, tableId, fieldType);
      expect(fieldId, `字段 ${fieldType} 没有 field_id`).not.toBe('');
      const value = legalValueFor(fieldType);
      const res = await patchRow(seed.aliceCookie, rowId, version, { [fieldId]: value });
      expect(res.status, `字段 ${fieldType} 写回失败：${JSON.stringify(res.body)}`).toBe(200);
      // 每次成功写回 version 恰 +1 —— 前端拿它当下一次的基线
      expect(res.body.data.version).toBe(version + 1);
      version = res.body.data.version;
      expected[fieldId] = value;
    }

    const db = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);
    // 逐字相等：key 是 field_id 不是字段名，值原样保存不做任何规整
    expect(db.rows[0].data).toEqual(expected);
  });

  it('类型不符返 400 且该格逐字未变', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    const numberField = await fieldIdOf(seed.aliceCookie, tableId, 'number');
    const selectField = await fieldIdOf(seed.aliceCookie, tableId, 'single_select');
    const urlField = await fieldIdOf(seed.aliceCookie, tableId, 'url');

    const before = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);

    const badPayloads: Array<Record<string, unknown>> = [
      { [numberField]: '12' }, // 字符串数字不是 number
      { [selectField]: '不在选项里' }, // 不在 options 内
      { [urlField]: 'javascript:alert(1)' }, // 非 http/https
      { ['00000000-0000-0000-0000-000000000000']: 'x' }, // field_id 不属于该表
    ];

    for (const payload of badPayloads) {
      const res = await patchRow(seed.aliceCookie, rowId, 1, payload);
      expect(res.status, `非法值应 400：${JSON.stringify(payload)}`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }

    const after = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);
    expect(after.rows[0].data).toEqual(before.rows[0].data);
  });

  it('表已软删后其行不可读写', async () => {
    const name = `待删表-${seed.sfx}`;
    const t = await createTable(seed.aliceCookie, name, 'org');
    const tid = t.body.data.table_id;
    const row = await createRow(seed.aliceCookie, tid);
    const rowId = row.body.data.row_id;

    await request(app)
      .delete(`/api/knowledge/db/tables/${tid}`)
      .set('Cookie', seed.aliceCookie)
      .send({ confirm_name: name });

    const list = await listRows(seed.aliceCookie, tid);
    expect(list.status).toBe(404);
    const patched = await patchRow(seed.aliceCookie, rowId, 1, {});
    expect(patched.status).toBe(404);
    // 反枚举：与随机 uuid 的 404 体逐字节同形（连 timestamp 都不许带）
    const random = await listRows(seed.aliceCookie, '11111111-2222-3333-4444-555555555555');
    expect(JSON.stringify(list.body)).toBe(JSON.stringify(random.body));
  });
});
