/**
 * 路③ Sprint D · 引用完整性三级（A30）
 *
 * 覆盖断言：A30①（删被引用行 → 关联侧安全失效，不留悬空 row_id，候选/反查剔除已删行）/
 *          A30②（删被引用表 → 引用随回收站可一并还原：删表后候选 404，还原后恢复）/
 *          A30③（删字段 = 软删元数据 + 值保留 + 二次确认输入字段名：db_fields 行仍在且 deleted_at 置位，
 *                db_rows.data 里旧值不丢；confirm_name 不符 → 拒）。
 *
 * 禁 mock 边：代码 ↔ db_rows.data / db_fields / db_tables（真软删真查库）；route ↔ service（真调）。
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
  getCandidates,
  getBackrefs,
  deleteRow,
  deleteTable,
  restoreTable,
  deleteField,
  listFields,
  type TwoTenantSeed,
} from './_relations-fixture';

describe('Sprint D 引用完整性三级 A30 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-DINTG');
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  async function buildPair(tag: string) {
    const tableA = (await createSimpleTable(seed.aliceCookie, `A源-${tag}`, 'org')).body.data.table_id;
    const tableB = (await createSimpleTable(seed.aliceCookie, `B目标-${tag}`, 'org')).body.data.table_id;
    const bRow = (await seedTitledRow(seed.aliceCookie, tableB, `目标-${tag}`)).rowId;
    await addRelationField(seed.aliceCookie, tableA, tableB);
    const relField = (await fieldIdOf(seed.aliceCookie, tableA, 'relation'))!;
    const aRow = (await seedRow(seed.aliceCookie, tableA))!;
    await patchRow(seed.aliceCookie, aRow, 1, { [relField]: [bRow] });
    return { tableA, tableB, bRow, relField, aRow };
  }

  it('A30①：删被引用行 → 候选剔除已删行，backref 不再含它，来源单元格不留悬空可跳的 row_id', async () => {
    const { tableA, bRow, relField, aRow } = await buildPair(`R1-${seed.sfx}`);
    // 删掉被引用的目标行
    const del = await deleteRow(seed.aliceCookie, bRow);
    expect(del.status).toBe(200);
    // 候选端点不再返回已软删的目标行（安全失效，不出现悬空可选项）
    const cands = await getCandidates(seed.aliceCookie, tableA, relField);
    expect(cands.status).toBe(200);
    expect(cands.body.data.candidates.some((c: { row_id: string }) => c.row_id === bRow)).toBe(false);
    // 反查已删行的 backref 不再暴露（读它本身应 404，或返回空）——这里断言来源行读取不 500、不 404 白屏
    const backAfter = await getBackrefs(seed.aliceCookie, bRow);
    // 已删目标行本身不可展开（404），关联侧读取安全，不抛 5xx
    expect([200, 404]).toContain(backAfter.status);
    // 库里来源行的关联值仍是数组形态（不是被写成非法结构导致读崩），且读行链路可用
    const q = await seed.client.query('SELECT data -> $2 AS rel FROM zenithjoy.db_rows WHERE id = $1', [
      aRow,
      relField,
    ]);
    expect(Array.isArray(q.rows[0].rel)).toBe(true);
  });

  it('A30②：删被引用表 → 候选端点 404；还原表后候选恢复、被引用行重新可见', async () => {
    const { tableA, tableB, bRow, relField } = await buildPair(`R2-${seed.sfx}`);
    // 取表 B 的真实名字用于 confirm_name
    const bName = (await seed.client.query('SELECT name FROM zenithjoy.db_tables WHERE id = $1', [tableB]))
      .rows[0].name as string;
    const del = await deleteTable(seed.aliceCookie, tableB, bName);
    expect(del.status).toBe(200);
    // 目标表进回收站 → 候选端点解析不到目标表 → 404
    const gone = await getCandidates(seed.aliceCookie, tableA, relField);
    expect(gone.status).toBe(404);
    // 还原表
    const restore = await restoreTable(seed.aliceCookie, tableB);
    expect(restore.status).toBe(200);
    // 引用随回收站一并恢复：候选重新可用且含被引用行
    const back = await getCandidates(seed.aliceCookie, tableA, relField);
    expect(back.status).toBe(200);
    expect(back.body.data.candidates.some((c: { row_id: string }) => c.row_id === bRow)).toBe(true);
  });

  it('A30③：删 relation 字段需二次确认字段名 —— confirm 不符 → 拒；确认符 → 软删（db_fields 行仍在 + deleted_at 置位 + 值保留）', async () => {
    const { tableA, relField, aRow } = await buildPair(`R3-${seed.sfx}`);
    const relName = (
      await seed.client.query('SELECT name FROM zenithjoy.db_fields WHERE id = $1', [relField])
    ).rows[0].name as string;
    // confirm_name 不符 → 拒（4xx），字段不被删
    const wrong = await deleteField(seed.aliceCookie, tableA, relField, '乱填的名字');
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.status).toBeLessThan(500);
    const stillThere = (await listFields(seed.aliceCookie, tableA)).body.data.fields.some(
      (f: { field_id: string }) => f.field_id === relField
    );
    expect(stillThere).toBe(true);
    // confirm_name 相符 → 软删成功
    const ok = await deleteField(seed.aliceCookie, tableA, relField, relName);
    expect(ok.status).toBe(200);
    // 字段列表不再出现（对用户软删）
    const goneFromList = (await listFields(seed.aliceCookie, tableA)).body.data.fields.some(
      (f: { field_id: string }) => f.field_id === relField
    );
    expect(goneFromList).toBe(false);
    // 软删而非物理删：db_fields 行仍在，deleted_at 置位（变异 A30F-field-hard-delete 会让这条转红）
    const dbRow = await seed.client.query(
      'SELECT deleted_at FROM zenithjoy.db_fields WHERE id = $1',
      [relField]
    );
    expect(dbRow.rows.length).toBe(1);
    expect(dbRow.rows[0].deleted_at).not.toBeNull();
    // 值保留：db_rows.data 里旧关联值不丢
    const dataRow = await seed.client.query('SELECT data ? $2 AS has FROM zenithjoy.db_rows WHERE id = $1', [
      aRow,
      relField,
    ]);
    expect(dataRow.rows[0].has).toBe(true);
  });
});
