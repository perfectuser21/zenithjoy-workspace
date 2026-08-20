/**
 * S2 剪贴板粘贴批量导入 + 单表行数上限 —— 自动建列一律「文本」，超限整批拒绝
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_rows / db_fields：粘贴会同时写这两张表，真 INSERT 真回读；
 *   - 上限判定 ↔ 真实已有行数：计数来自真库 SELECT，不是入参里带的数字。
 *
 * 上限用 WORKBENCH_ROW_LIMIT 覆写成小值来证明闸真的在（真插 5000 行会把 CI 预算烧光，
 * 已在合同 ## 未覆盖真实链路清单 登记）；默认值 5000 由本文件末尾那条用例单独钉死。
 *
 * TDD Red：粘贴端点与上限常量在 origin/main 上都不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createRow,
  pasteRows,
  listRows,
  type TwoTenantSeed,
} from './_rows-fixture';

let seed: TwoTenantSeed;
const savedLimit = process.env.WORKBENCH_ROW_LIMIT;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-PASTE');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

beforeEach(() => {
  delete process.env.WORKBENCH_ROW_LIMIT;
});

afterEach(() => {
  if (savedLimit === undefined) delete process.env.WORKBENCH_ROW_LIMIT;
  else process.env.WORKBENCH_ROW_LIMIT = savedLimit;
});

async function freshTable(name: string): Promise<string> {
  const t = await createTable(seed.aliceCookie, `${name}-${seed.sfx}`, 'org');
  return t.body.data.table_id;
}

describe('S2 粘贴导入与行数上限 [BEHAVIOR]', () => {
  it('粘贴 N 行落库恰 N 行', async () => {
    const tableId = await freshTable('粘贴表');
    const res = await pasteRows(
      seed.aliceCookie,
      tableId,
      ['字段-text', '字段-long_text'],
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
        ['a3', 'b3'],
      ]
    );
    expect(res.status).toBe(201);
    expect(res.body.data.inserted).toBe(3);
    expect(res.body.data.row_ids).toHaveLength(3);

    const db = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1 AND r.deleted_at IS NULL',
      [tableId]
    );
    expect(db.rows[0].n).toBe(3);
  });

  it('未匹配列自动建为文本类型', async () => {
    const tableId = await freshTable('自动建列表');
    const res = await pasteRows(
      seed.aliceCookie,
      tableId,
      ['字段-number', '全新列'],
      [['1', 'x1']]
    );
    expect(res.status).toBe(201);
    expect(res.body.data.created_fields).toHaveLength(1);
    expect(res.body.data.created_fields[0].name).toBe('全新列');
    // 合同 J9：一律「文本」，不做类型推断——推错类型会当场丢数据且字段类型创建后不可变
    expect(res.body.data.created_fields[0].field_type).toBe('text');

    const field = await seed.client.query(
      'SELECT f.id::text AS id, f.field_type FROM zenithjoy.db_fields f WHERE f.table_id = $1 AND f.name = $2',
      [tableId, '全新列']
    );
    expect(field.rowCount).toBe(1);
    expect(field.rows[0].field_type).toBe('text');

    // 粘贴的值按 field_id 落进 data，不是按列名也不是按列序号
    const row = await seed.client.query(
      'SELECT r.data ->> $2 AS cell FROM zenithjoy.db_rows r WHERE r.table_id = $1',
      [tableId, field.rows[0].id]
    );
    expect(row.rows[0].cell).toBe('x1');
  });

  it('超上限整批拒绝且库中零新增', async () => {
    process.env.WORKBENCH_ROW_LIMIT = '3';
    const tableId = await freshTable('超限表');
    await createRow(seed.aliceCookie, tableId);
    await createRow(seed.aliceCookie, tableId);

    const rowsBefore = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1',
      [tableId]
    );
    const fieldsBefore = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_fields f WHERE f.table_id = $1',
      [tableId]
    );

    // 已有 2 行 + 本批 3 行 = 5 > 3 → 整批拒绝，不许落两行再喊停
    const res = await pasteRows(seed.aliceCookie, tableId, ['新列A'], [['x'], ['y'], ['z']]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROW_LIMIT_EXCEEDED');
    // 提示必须让人知道「上限多少 / 已经有多少」，否则用户不知道该删几行
    expect(res.body.error.message).toMatch(/3/);
    expect(res.body.error.message).toMatch(/已有/);

    const rowsAfter = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1',
      [tableId]
    );
    const fieldsAfter = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_fields f WHERE f.table_id = $1',
      [tableId]
    );
    expect(rowsAfter.rows[0].n).toBe(rowsBefore.rows[0].n);
    // 自动建列也必须一并回滚，否则表上留下一个没有任何数据的孤儿字段
    expect(fieldsAfter.rows[0].n).toBe(fieldsBefore.rows[0].n);
  });

  it('行数达上限时单条建行同样被拒', async () => {
    process.env.WORKBENCH_ROW_LIMIT = '1';
    const tableId = await freshTable('单行上限表');
    const first = await createRow(seed.aliceCookie, tableId);
    expect(first.status).toBe(201);

    const second = await createRow(seed.aliceCookie, tableId);
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('ROW_LIMIT_EXCEEDED');
  });

  it('不设环境变量时上限默认为 5000', async () => {
    const tableId = await freshTable('默认上限表');
    const res = await listRows(seed.aliceCookie, tableId);
    expect(res.status).toBe(200);
    // 5000 是产品阈值（合同 J12），CI 里用小值只是为了证明闸在，默认值必须原样是它
    expect(res.body.data.row_limit).toBe(5000);
  });
});
