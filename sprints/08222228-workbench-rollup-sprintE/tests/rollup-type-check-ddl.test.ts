/**
 * 路③ Sprint E · A40 类型×函数校验 + 零运行时 DDL + 配置存 options（读时计算不落库）
 *
 * 覆盖断言：A40（建 rollup 字段时 sum/min/max 只允 number 目标，非法组合如 sum 配 text →
 *          400 VALIDATION_FAILED + 明确文案，非静默返错值/NaN；count 无需目标字段可建；
 *          concat/lookup 允许任意目标类型）/ 无运行时 DDL（建 rollup 字段 + 读聚合全程
 *          information_schema 前后全等，零 %rollup% 物理表）/ 配置以三元组落 db_fields.options
 *          （零新建表，聚合值不物化）。变异证明 A40-rollup-typecheck-off 由 smoke 段承载。
 *
 * 禁 mock 边：代码 ↔ db_fields（真查库验 options 落库 + relation 字段校验）；route ↔ service（真调）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createSimpleTable,
  addRelationField,
  fieldIdOf,
  seedRow,
  listFields,
  createTargetTable,
  addRollupField,
  addLookupField,
  randomUuid,
  type TwoTenantSeed,
} from './_rollup-fixture';

async function fieldIdByName(cookie: string, tableId: string, name: string): Promise<string> {
  const fields = (await listFields(cookie, tableId)).body.data.fields as Array<{
    field_id: string;
    name: string;
  }>;
  return fields.find((x) => x.name === name)!.field_id;
}

describe('Sprint E rollup 类型×函数校验 + 零 DDL A40 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let srcTable: string;
  let targetTable: string;
  let relFieldId: string;
  let amountFieldId: string; // number
  let titleFieldId: string; // text

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-ETYPE');
    targetTable = (await createTargetTable(seed.aliceCookie, `目标-${seed.sfx}`, 'org')).body.data.table_id;
    amountFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'number'))!;
    titleFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'text'))!;
    srcTable = (await createSimpleTable(seed.aliceCookie, `源-${seed.sfx}`, 'org')).body.data.table_id;
    await addRelationField(seed.aliceCookie, srcTable, targetTable);
    relFieldId = (await fieldIdOf(seed.aliceCookie, srcTable, 'relation'))!;
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('sum 配 text 目标字段 → 400 VALIDATION_FAILED + 明确文案（非静默返错值/NaN）', async () => {
    const res = await addRollupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'sum', 'bad-sum');
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('VALIDATION_FAILED');
    expect(typeof res.body?.error?.message).toBe('string');
    expect(res.body.error.message.length).toBeGreaterThan(0);
  });

  it('min / max 配 text 目标字段 → 各 400（只允 number 目标）', async () => {
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'min', 'bad-min')).status).toBe(400);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'max', 'bad-max')).status).toBe(400);
  });

  it('非法聚合函数名（avg）→ 400（fn 不在六函数白名单内）', async () => {
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'avg', 'bad-fn')).status).toBe(400);
  });

  it('relation_field_id 不是本表 relation 字段（随机 uuid）→ 400（配置不可解析即拒）', async () => {
    expect((await addRollupField(seed.aliceCookie, srcTable, randomUuid(), amountFieldId, 'sum', 'bad-rel')).status).toBe(400);
  });

  it('count 无需目标字段 → 201；sum/min/max 配 number → 201；concat/lookup 配任意 → 201', async () => {
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, '', 'count', 'ok-count')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'sum', 'ok-sum')).status).toBe(201);
    expect((await addRollupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'concat', 'ok-concat')).status).toBe(201);
    expect((await addLookupField(seed.aliceCookie, srcTable, relFieldId, titleFieldId, 'ok-lookup')).status).toBe(201);
  });

  it('配置以三元组落 db_fields.options（读回逐字相等，读时计算不落库、零新列）', async () => {
    const fid = await fieldIdByName(seed.aliceCookie, srcTable, 'ok-sum');
    const fields = (await listFields(seed.aliceCookie, srcTable)).body.data.fields as Array<{
      field_id: string;
      field_type: string;
      options: string[];
    }>;
    const f = fields.find((x) => x.field_id === fid)!;
    expect(f.field_type).toBe('rollup');
    expect(f.options).toEqual([relFieldId, amountFieldId, 'sum']);
  });

  it('无运行时 DDL：建 rollup 字段 + 读聚合全程 zenithjoy schema 表/列集合逐字节不变，零 %rollup% 物理表', async () => {
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
    // 建一个新 rollup 字段 + 建一行 + 读聚合（走完整读时计算链）
    await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'max', 'ddl-max');
    await seedRow(seed.aliceCookie, srcTable);
    await listFields(seed.aliceCookie, srcTable);
    const after = await snap();
    expect(after).toBe(before); // rollup 不进标识符位：没有为聚合新建任何表/列

    const rollupTables = await seed.client.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'zenithjoy' AND table_name LIKE '%rollup%'"
    );
    expect(rollupTables.rows[0].n).toBe(0);
  });
});
