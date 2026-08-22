/**
 * 路③ Sprint E · A38 rollup 聚合隔离只跨本 org 目标行
 *
 * 覆盖断言：A38（把某目标行的 org_id 在库里直接改成 B 企业后，A 企业读该 rollup —— 被篡改行
 *          **不进入聚合基数**：count 减 1、sum 不含该行值，聚合值等于「仅本 org 存活目标行」的期望）。
 *          变异证明 A38-rollup-org-bypass（去掉聚合读服务 `AND org_id=$orgId`）由 smoke 段承载。
 *
 * 禁 mock 边：代码 ↔ db_rows（真篡改 org_id 注入、真查库）；route ↔ workbench-rollup.service（真调）。
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
  getRollups,
  rollupCell,
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

describe('Sprint E rollup 聚合隔离只跨本 org A38 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let srcTable: string;
  let relFieldId: string;
  let amountFieldId: string;
  let srcRow: string;
  let r2: string; // 将被篡改 org 的目标行
  let countFieldId: string;
  let sumFieldId: string;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-EISO');
    const targetTable = (await createTargetTable(seed.aliceCookie, `目标-${seed.sfx}`, 'org')).body.data
      .table_id;
    amountFieldId = (await fieldIdOf(seed.aliceCookie, targetTable, 'number'))!;
    const r0 = await seedTargetRow(seed.aliceCookie, targetTable, '甲', 10);
    const r1 = await seedTargetRow(seed.aliceCookie, targetTable, '乙', 20);
    r2 = await seedTargetRow(seed.aliceCookie, targetTable, '丙', 30);

    srcTable = (await createSimpleTable(seed.aliceCookie, `源-${seed.sfx}`, 'org')).body.data.table_id;
    await addRelationField(seed.aliceCookie, srcTable, targetTable);
    relFieldId = (await fieldIdOf(seed.aliceCookie, srcTable, 'relation'))!;
    await addRollupField(seed.aliceCookie, srcTable, relFieldId, '', 'count');
    await addRollupField(seed.aliceCookie, srcTable, relFieldId, amountFieldId, 'sum');
    countFieldId = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-count');
    sumFieldId = await fieldIdByName(seed.aliceCookie, srcTable, 'rollup-sum');

    srcRow = (await seedRow(seed.aliceCookie, srcTable))!;
    await patchRow(seed.aliceCookie, srcRow, 1, { [relFieldId]: [r0, r1, r2] });
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('篡改前基线：count=3、sum=60（10+20+30）', async () => {
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    expect(rollupCell(body, srcRow, countFieldId)!.value).toBe(3);
    expect(rollupCell(body, srcRow, sumFieldId)!.value).toBe(60);
  });

  it('把目标行 org 直接改成 B 企业 → 该行不进聚合基数：count 减 1（=2）、sum 不含该行（=30）', async () => {
    await seed.client.query('UPDATE zenithjoy.db_rows SET org_id = $2 WHERE id = $1', [
      r2,
      seed.orgBTenantId,
    ]);
    const body = (await getRollups(seed.aliceCookie, srcTable)).body;
    // count 只数本 org 存活目标行 → 2
    expect(rollupCell(body, srcRow, countFieldId)!.value).toBe(2);
    // sum 只含本 org 行 → 10+20=30，绝不因库里脏行泄露对方数据（30 那行被剔除）
    expect(rollupCell(body, srcRow, sumFieldId)!.value).toBe(30);
    // 还原，避免污染 cleanup
    await seed.client.query('UPDATE zenithjoy.db_rows SET org_id = $2 WHERE id = $1', [
      r2,
      seed.orgATenantId,
    ]);
  });

  it('反枚举：carol(B企业)以 A 企业真实存在的表 id 和随机不存在 id 各调 /rollups → 两组响应逐字节相同（404 优先 400，无 timestamp）', async () => {
    // 声明即承重：/rollups 的 404 三性质（notFoundBody 无 timestamp / 404 优先 400 /
    // 跨企业·随机不存在一律 404 且逐字节相同）必须有可执行断言（沿 Sprint D relations-isolation-enum 口径）。
    const bodyReal: string[] = [];
    const bodyRandom: string[] = [];
    const statusReal: number[] = [];
    const statusRandom: number[] = [];
    for (let i = 0; i < 5; i++) {
      const rnd = randomUuid();
      const rReal = await getRollups(seed.carolCookie, srcTable); // A 企业真实存在的表
      const rRandom = await getRollups(seed.carolCookie, rnd); // 语法合法但不存在
      statusReal.push(rReal.status);
      statusRandom.push(rRandom.status);
      bodyReal.push(JSON.stringify(rReal.body));
      bodyRandom.push(JSON.stringify(rRandom.body));
    }
    // 两组状态码全 404（不因「表真的存在」而不同，也不是 400/403）
    expect(statusReal.every((s) => s === 404)).toBe(true);
    expect(statusRandom.every((s) => s === 404)).toBe(true);
    // 响应体逐字节相同：真实存在与随机不存在无从区分（不泄露存在性）
    const uniq = new Set([...bodyReal, ...bodyRandom]);
    expect(uniq.size).toBe(1);
    // notFoundBody 不带 timestamp（带上就能靠比对字节分辨 id 是否真实存在）
    expect(JSON.parse(bodyReal[0])).not.toHaveProperty('timestamp');
  });
});
