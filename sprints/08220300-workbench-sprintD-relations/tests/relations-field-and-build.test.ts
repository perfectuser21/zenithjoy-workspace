/**
 * 路③ Sprint D · 关联字段配置 + 建关联落 JSONB + 零运行时 DDL
 *
 * 覆盖断言：A27①（写入时目标表 org == 本组织才放行）/ 关联值落 `db_rows.data` JSONB(目标 row_id 数组) /
 *          无运行时 DDL（建 relation 字段 + 建关联全程 information_schema 逐字节不变，relation 不进标识符位）。
 *
 * 禁 mock 边：代码 ↔ db_fields / db_rows.data（真 INSERT 真 SELECT）；route ↔ service（真调）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createSimpleTable,
  addRelationField,
  fieldIdOf,
  seedTitledRow,
  seedRow,
  patchRow,
  listFields,
  type TwoTenantSeed,
} from './_relations-fixture';

describe('Sprint D 关联字段配置 + 建关联落 JSONB [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let tableA: string; // 来源表（本组织，含 relation 字段）
  let tableB: string; // 目标表（本组织）
  let relFieldId: string;
  let bRow1: string;
  let bRow2: string;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-DBUILD');
    tableA = (await createSimpleTable(seed.aliceCookie, `A源-${seed.sfx}`, 'org')).body.data.table_id;
    tableB = (await createSimpleTable(seed.aliceCookie, `B目标-${seed.sfx}`, 'org')).body.data.table_id;
    const b1 = await seedTitledRow(seed.aliceCookie, tableB, '目标记录甲');
    const b2 = await seedTitledRow(seed.aliceCookie, tableB, '目标记录乙');
    bRow1 = b1.rowId;
    bRow2 = b2.rowId;
    const res = await addRelationField(seed.aliceCookie, tableA, tableB);
    expect(res.status).toBe(201);
    relFieldId = (await fieldIdOf(seed.aliceCookie, tableA, 'relation'))!;
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('新增 relation 字段返回 201 且 field_type 逐字为 relation、目标表存入 options[0]', async () => {
    const fields = (await listFields(seed.aliceCookie, tableA)).body.data.fields;
    const rel = fields.find((f: { field_type: string }) => f.field_type === 'relation');
    expect(rel).toBeTruthy();
    expect(rel.field_type).toBe('relation');
    expect(rel.options[0]).toBe(tableB);
  });

  it('建关联：PATCH 行把目标 row_id 数组写进 db_rows.data JSONB，读回逐字相等', async () => {
    const aRow = (await seedRow(seed.aliceCookie, tableA))!;
    const res = await patchRow(seed.aliceCookie, aRow, 1, { [relFieldId]: [bRow1, bRow2] });
    expect(res.status).toBe(200);
    // 真查库：关联值确实以数组落在 db_rows.data 的 <relFieldId> 键上（不是新建表）
    const q = await seed.client.query(
      "SELECT data -> $2 AS rel FROM zenithjoy.db_rows WHERE id = $1",
      [aRow, relFieldId]
    );
    expect(q.rows[0].rel).toEqual([bRow1, bRow2]);
  });

  it('目标表 org ≠ 本组织（跨企业）→ 建 relation 字段被拒（A27① 写入校验）', async () => {
    // carol 属 B 企业，她建的表 tableA 用不到；这里用 alice 的表指向 carol 的跨企业表
    const carolTable = (await createSimpleTable(seed.carolCookie, `C表-${seed.sfx}`, 'org')).body.data
      .table_id;
    const res = await addRelationField(seed.aliceCookie, tableA, carolTable, '跨企业关联');
    // 跨企业目标不可解析 → 拒（400 校验失败），绝不 2xx
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('无运行时 DDL：建 relation 字段 + 建关联全程 zenithjoy schema 的表/列集合逐字节不变', async () => {
    const snap = async () => {
      const t = await seed.client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'zenithjoy' ORDER BY table_name"
      );
      const c = await seed.client.query(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'zenithjoy' ORDER BY table_name, column_name"
      );
      return JSON.stringify({ t: t.rows, c: c.rows });
    };
    const before = await snap();
    // 跑一遍完整关联链：建字段（已在 beforeAll 建过，这里再建一个）+ 建关联
    const tableC = (await createSimpleTable(seed.aliceCookie, `又一表-${seed.sfx}`, 'org')).body.data
      .table_id;
    await addRelationField(seed.aliceCookie, tableC, tableB, '又一关联');
    const cRelField = (await fieldIdOf(seed.aliceCookie, tableC, 'relation'))!;
    const cRow = (await seedRow(seed.aliceCookie, tableC))!;
    await patchRow(seed.aliceCookie, cRow, 1, { [cRelField]: [bRow1] });
    const after = await snap();
    // relation 不进标识符位：没有为关联新建任何表/列
    expect(after).toBe(before);
  });

  it('无 db_relations 之类关联物理表：information_schema 里零命中 relation 命名的表', async () => {
    const q = await seed.client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'zenithjoy' AND table_name LIKE '%relation%'"
    );
    expect(q.rows[0].n).toBe(0);
  });
});
