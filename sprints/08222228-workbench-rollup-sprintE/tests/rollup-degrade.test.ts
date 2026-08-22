/**
 * 路③ Sprint E · A39 rollup 失效降级三支
 *
 * 覆盖断言：A39（① 删 rollup 依赖的 relation 字段 ② 删 rollup 目标字段 ③ 目标表软删 —— 三支都
 *          令 rollup 值置 null + degraded=true + 单元格可见降级标记，**不悬空、不 500、不白屏**；
 *          复用 relation 解析链 getTable 返 null 的机制，照抄 views A22 读时降级范式的形状）。
 *          变异证明 A39-rollup-degrade-bypass（降级分支改成裸访问已删字段/直接抛错/无视 getTable
 *          返 null）由 smoke 段承载，三支须一并转红。
 *
 * 禁 mock 边：代码 ↔ db_fields / db_tables（真软删真查）；route ↔ workbench-rollup.service（真调）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createSimpleTable,
  addRelationField,
  fieldIdOf,
  seedRow,
  patchRow,
  listFields,
  createTargetTable,
  addRollupField,
  seedTargetRow,
  deleteField,
  deleteTable,
  getRollups,
  rollupCell,
  type TwoTenantSeed,
} from './_rollup-fixture';

async function fieldIdByName(cookie: string, tableId: string, name: string): Promise<string> {
  const fields = (await listFields(cookie, tableId)).body.data.fields as Array<{
    field_id: string;
    name: string;
  }>;
  return fields.find((x) => x.name === name)!.field_id;
}

describe('Sprint E rollup 失效降级三支 A39 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-EDEG');
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  /** 建一套：目标表(标题+金额)+一行 → 源表+relation+sum rollup(over 金额) → 一条源行关联该目标行。 */
  async function buildOne(tag: string) {
    const targetTable = (await createTargetTable(seed.aliceCookie, `目标-${tag}`, 'org')).body.data
      .table_id;
    const targetName = (
      await seed.client.query('SELECT name FROM zenithjoy.db_tables WHERE id = $1', [targetTable])
    ).rows[0].name as string;
    const amountFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'number'))!;
    const tRow = await seedTargetRow(seed.aliceCookie, targetTable, '甲', 10);
    const srcTable = (await createSimpleTable(seed.aliceCookie, `源-${tag}`, 'org')).body.data.table_id;
    await addRelationField(seed.aliceCookie, srcTable, targetTable);
    const relFieldId = (await fieldIdOf(seed.aliceCookie, srcTable, 'relation'))!;
    await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'sum');
    const sumFieldId = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-sum');
    const srcRow = (await seedRow(seed.aliceCookie, srcTable))!;
    await patchRow(seed.aliceCookie, srcRow, 1, { [relFieldId]: [tRow] });
    return { targetTable, targetName, amountFieldId, srcTable, relFieldId, sumFieldId, srcRow };
  }

  it('A39① 删 relation 字段 → rollup 值置 null + degraded=true（不悬空、不 500）', async () => {
    const b = await buildOne(`R1-${seed.sfx}`);
    // 基线：sum=10、未降级
    const base = (await getRollups(seed.aliceCookie, b.srcTable)).body;
    expect(rollupCell(base, b.srcRow, b.sumFieldId)!.value).toBe(10);
    // 删 rollup 依赖的 relation 字段（confirm_name = '关联'）
    expect((await deleteField(seed.aliceCookie, b.srcTable, b.relFieldId, '关联')).status).toBe(200);
    const res = await getRollups(seed.aliceCookie, b.srcTable);
    expect(res.status).toBe(200); // 不 500
    const cell = rollupCell(res.body, b.srcRow, b.sumFieldId);
    expect(cell).toBeTruthy(); // 单元格仍在（可见降级标记），不悬空消失
    expect(cell!.value).toBeNull();
    expect(cell!.degraded).toBe(true);
  });

  it('A39② 删目标字段 → rollup 值置 null + degraded=true', async () => {
    const b = await buildOne(`R2-${seed.sfx}`);
    // 删目标表的金额字段（confirm_name = '金额'）
    expect((await deleteField(seed.aliceCookie, b.targetTable, b.amountFieldId, '金额')).status).toBe(200);
    const res = await getRollups(seed.aliceCookie, b.srcTable);
    expect(res.status).toBe(200);
    const cell = rollupCell(res.body, b.srcRow, b.sumFieldId);
    expect(cell!.value).toBeNull();
    expect(cell!.degraded).toBe(true);
  });

  it('A39③ 目标表软删 → rollup 值置 null + degraded=true（复用 getTable 返 null，不白屏）', async () => {
    const b = await buildOne(`R3-${seed.sfx}`);
    expect((await deleteTable(seed.aliceCookie, b.targetTable, b.targetName)).status).toBe(200);
    const res = await getRollups(seed.aliceCookie, b.srcTable);
    expect(res.status).toBe(200);
    const cell = rollupCell(res.body, b.srcRow, b.sumFieldId);
    expect(cell!.value).toBeNull();
    expect(cell!.degraded).toBe(true);
  });
});
