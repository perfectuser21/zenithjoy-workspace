/**
 * 路③ Sprint E · A37 rollup 聚合值正确性 + 数值规整 + 多值格式化
 *
 * 覆盖断言：A37（count/sum/min/max/concat/lookup 逐函数与手算期望逐一相等；sum/min/max 聚合前
 *          `Number()` 规整——JSONB 数字以 string 存的 `"12"` 须计入 sum，绝不字符串拼接冒充；
 *          非数值目标行跳过 + degraded）/ J15（concat/lookup 多值按 row_order 升序 `, ` 拼接不截断）。
 *
 * 禁 mock 边：代码 ↔ db_rows.data（真 SELECT 顺 relation 目标行聚合，含 string 数字规整）；
 *            route ↔ workbench-rollup.service（真调）。读时计算不落库。
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
  addLookupField,
  seedTargetRow,
  forceCellValue,
  getRollups,
  rollupCell,
  ROLLUP_ENVELOPE_KEYS,
  ROLLUP_CELL_KEYS,
  ROLLUP_CELL_BANNED_KEYS,
  type TwoTenantSeed,
} from './_rollup-fixture';

/** 按字段名取 field_id（多个 rollup 字段共存，靠名字区分）。 */
async function fieldIdByName(cookie: string, tableId: string, name: string): Promise<string> {
  const fields = (await listFields(cookie, tableId)).body.data.fields as Array<{
    field_id: string;
    name: string;
  }>;
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`字段未找到：${name}`);
  return f.field_id;
}

describe('Sprint E rollup 聚合值正确性 A37 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let srcTable: string;
  let targetTable: string;
  let relFieldId: string;
  let amountFieldId: string; // 目标表 number 字段（金额）
  let titleFieldId: string; // 目标表 text 字段（标题）
  let srcClean: string; // 关联 [r0=10, r1=30, r2="12"]
  let srcMixed: string; // 关联 [r0, r1, r2, r3="abc"]
  const ids: {
    count?: string;
    sum?: string;
    min?: string;
    max?: string;
    concat?: string;
    lookup?: string;
  } = {};

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-EAGG');
    // 目标表：标题(text)+金额(number)，四行 —— 其中 r2 金额以 string "12" 存、r3 以 "abc" 存
    targetTable = (await createTargetTable(seed.aliceCookie, `目标-${seed.sfx}`, 'org')).body.data.table_id;
    amountFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'number'))!;
    titleFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'text'))!;
    const r0 = await seedTargetRow(seed.aliceCookie, targetTable, '甲', 10);
    const r1 = await seedTargetRow(seed.aliceCookie, targetTable, '乙', 30);
    const r2 = await seedTargetRow(seed.aliceCookie, targetTable, '丙', 99);
    const r3 = await seedTargetRow(seed.aliceCookie, targetTable, '丁', 1);
    // 模拟「粘贴导入一律文本」：金额以 JSONB string 存
    await forceCellValue(seed.client, r2, amountFieldId, '12');
    await forceCellValue(seed.client, r3, amountFieldId, 'abc');

    // 源表 + relation 字段
    srcTable = (await createSimpleTable(seed.aliceCookie, `源-${seed.sfx}`, 'org')).body.data.table_id;
    await addRelationField(seed.aliceCookie, srcTable, targetTable);
    relFieldId = (await fieldIdOf(seed.aliceCookie, srcTable, 'relation'))!;

    // 六个聚合字段
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, '', 'count')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'sum')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'min')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'max')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'concat')).status).toBe(201);
    expect((await addLookupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId)).status).toBe(201);
    ids.count = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-count');
    ids.sum = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-sum');
    ids.min = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-min');
    ids.max = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-max');
    ids.concat = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-concat');
    ids.lookup = await fieldIdByName(seed.aliceCookie, srcTable, 'lookup');

    // 两条源行
    srcClean = (await seedRow(seed.aliceCookie, srcTable))!;
    await patchRow(seed.aliceCookie, srcClean, 1, { [relFieldId]: [r0, r1, r2] });
    srcMixed = (await seedRow(seed.aliceCookie, srcTable))!;
    await patchRow(seed.aliceCookie, srcMixed, 1, { [relFieldId]: [r0, r1, r2, r3] });
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('count 聚合：关联 3 行 → count 恰为 3（非降级）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    const cell = rollupCell(body, srcClean, ids.count!);
    expect(cell).toBeTruthy();
    expect(cell!.fn).toBe('count');
    expect(cell!.value).toBe(3);
    expect(cell!.degraded).toBe(false);
  });

  it('sum 聚合：10 + 30 + string "12" = 52（string 数字规整计入，绝不字符串拼接冒充 sum）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    const cell = rollupCell(body, srcClean, ids.sum!);
    expect(cell!.fn).toBe('sum');
    expect(cell!.value).toBe(52);
    // 明确堵「字符串拼接冒充 sum」：值不是 "103012" 之类
    expect(cell!.value).not.toBe('103012');
    expect(typeof cell!.value).toBe('number');
  });

  it('min / max 聚合：Number() 规整后 min=10、max=30（string "12" 参与比较）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    expect(rollupCell(body, srcClean, ids.min!)!.value).toBe(10);
    expect(rollupCell(body, srcClean, ids.max!)!.value).toBe(30);
  });

  it('concat 聚合：标题按 row_order 升序 `, ` 拼接为「甲, 乙, 丙」（不截断）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    const cell = rollupCell(body, srcClean, ids.concat!);
    expect(cell!.fn).toBe('concat');
    expect(cell!.value).toBe('甲, 乙, 丙');
  });

  it('lookup 取值：关联行标题按 row_order 升序 `, ` 拼接为「甲, 乙, 丙」（多值不只取第一行）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    const cell = rollupCell(body, srcClean, ids.lookup!);
    expect(cell!.fn).toBe('lookup');
    expect(cell!.value).toBe('甲, 乙, 丙');
  });

  it('非数值目标行跳过 + degraded：混入 "abc" 后 sum 仍为 52、degraded=true（跳过非数值，不拼接）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    const cell = rollupCell(body, srcMixed, ids.sum!);
    expect(cell!.value).toBe(52); // abc 被跳过，10+30+12
    expect(cell!.degraded).toBe(true);
    expect(typeof cell!.value).toBe('number');
  });

  it('Response Schema：envelope keys 恰 [cells,table_id]、cell keys 恰五键、禁用字段名一个不出现', async () => {
    const res = await getRollups(seed.aliceCookie, srcTable);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(ROLLUP_ENVELOPE_KEYS);
    expect(res.body.data.table_id).toBe(srcTable);
    expect(res.body.data.cells.length).toBeGreaterThan(0);
    for (const c of res.body.data.cells) {
      expect(Object.keys(c).sort()).toEqual(ROLLUP_CELL_KEYS);
      for (const banned of ROLLUP_CELL_BANNED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(c, banned)).toBe(false);
      }
    }
  });
});
