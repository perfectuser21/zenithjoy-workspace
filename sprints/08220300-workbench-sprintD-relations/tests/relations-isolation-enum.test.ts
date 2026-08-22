/**
 * 路③ Sprint D · 组织隔离三向 + 反枚举 + 「仅自己」表零泄露
 *
 * 覆盖断言：A27②（读路径二次校验：目标行 org 被库里改成他企业后展开关联命中占位，不泄露对方数据）/
 *          A28（反枚举：跨企业真实存在的表 id 与随机不存在 id 各调多次，响应逐字节相同，404 优先于 400）/
 *          A31（「仅自己」表零泄露：他人不得建关联到别人私有表；导出含指向私有表 relation 时 grep 不到对方行标题）。
 *
 * 禁 mock 边：代码 ↔ db_tables/db_rows（真篡改 org_id 注入、真查库）；route ↔ service（真调）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
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
  DB_BASE,
  randomUuid,
  type TwoTenantSeed,
} from './_relations-fixture';

describe('Sprint D 组织隔离三向 + 反枚举 + 仅自己零泄露 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let aTable: string; // A 企业 alice 的 org 表
  let aRelField: string;
  let bTargetTable: string; // A 企业目标表
  let bRow: string;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-DISO');
    aTable = (await createSimpleTable(seed.aliceCookie, `A源-${seed.sfx}`, 'org')).body.data.table_id;
    bTargetTable = (await createSimpleTable(seed.aliceCookie, `A目标-${seed.sfx}`, 'org')).body.data
      .table_id;
    bRow = (await seedTitledRow(seed.aliceCookie, bTargetTable, '机密标题ABC')).rowId;
    await addRelationField(seed.aliceCookie, aTable, bTargetTable);
    aRelField = (await fieldIdOf(seed.aliceCookie, aTable, 'relation'))!;
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('反枚举：carol(B企业)以 A 企业真实存在的表 id 和随机不存在 id 各调候选端点，两组响应逐字节相同（404 优先于 400）', async () => {
    const bodyReal: string[] = [];
    const bodyRandom: string[] = [];
    const statusReal: number[] = [];
    const statusRandom: number[] = [];
    for (let i = 0; i < 5; i++) {
      const rnd = randomUuid();
      const rReal = await getCandidates(seed.carolCookie, aTable, aRelField);
      const rRandom = await getCandidates(seed.carolCookie, rnd, aRelField);
      statusReal.push(rReal.status);
      statusRandom.push(rRandom.status);
      bodyReal.push(JSON.stringify(rReal.body));
      bodyRandom.push(JSON.stringify(rRandom.body));
    }
    // 两组状态码全 404（不是 400/403，也不因"表真的存在"而不同）
    expect(statusReal.every((s) => s === 404)).toBe(true);
    expect(statusRandom.every((s) => s === 404)).toBe(true);
    // 响应体逐字节相同：真实存在与随机不存在无从区分（不泄露存在性）
    const uniq = new Set([...bodyReal, ...bodyRandom]);
    expect(uniq.size).toBe(1);
    // 无 timestamp 之类可区分信号（notFoundBody 不带时间戳）
    expect(JSON.parse(bodyReal[0])).not.toHaveProperty('timestamp');
  });

  it('A27② 读路径二次校验：把目标行 org 直接在库里改成 B 企业后展开候选，该行不再出现（命中占位，不泄露对方数据）', async () => {
    const before = await getCandidates(seed.aliceCookie, aTable, aRelField);
    expect(before.body.data.candidates.some((c: { row_id: string }) => c.row_id === bRow)).toBe(true);
    // 直接篡改：把 bRow 的 org 改成 B 企业（模拟脏数据/越权写入）
    await seed.client.query('UPDATE zenithjoy.db_rows SET org_id = $2 WHERE id = $1', [
      bRow,
      seed.orgBTenantId,
    ]);
    const after = await getCandidates(seed.aliceCookie, aTable, aRelField);
    expect(after.status).toBe(200);
    // 读路径二次校验命中：被改成他企业的行不再作为候选返回（org 不匹配即剔除）
    expect(after.body.data.candidates.some((c: { row_id: string }) => c.row_id === bRow)).toBe(false);
    // 还原，避免污染 cleanup
    await seed.client.query('UPDATE zenithjoy.db_rows SET org_id = $2 WHERE id = $1', [
      bRow,
      seed.orgATenantId,
    ]);
  });

  it('A31①：同组织他人(bob)不得对 alice 的「仅自己」私有表建关联 —— 目标不可解析即拒', async () => {
    const alicePrivate = (
      await createSimpleTable(seed.aliceCookie, `Alice私有-${seed.sfx}`, 'private')
    ).body.data.table_id;
    const bobTable = (await createSimpleTable(seed.bobCookie, `Bob源-${seed.sfx}`, 'org')).body.data
      .table_id;
    const res = await addRelationField(seed.bobCookie, bobTable, alicePrivate, '偷指私有');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('A31②：导出含 relation 的表 —— 导出文件含目标 row_id 占位，但 grep 不到目标行标题（不内联对方数据）', async () => {
    // 建一条 aTable 行，真的关联到含机密标题的 bRow
    const srcRow = (await request(app).post(`${DB_BASE}/tables/${aTable}/rows`).set('Cookie', seed.aliceCookie))
      .body.data.row_id;
    await request(app)
      .patch(`${DB_BASE}/rows/${srcRow}`)
      .set('Cookie', seed.aliceCookie)
      .send({ version: 1, data: { [aRelField]: [bRow] } });
    const exportRes = await request(app)
      .get(`${DB_BASE}/tables/${aTable}/export`)
      .set('Cookie', seed.aliceCookie);
    expect(exportRes.status).toBe(200);
    const dump = JSON.stringify(exportRes.body);
    // 关联单元格导出的是目标 row_id（占位），但绝不内联目标行标题
    expect(dump).toContain(bRow);
    expect(dump).not.toContain('机密标题ABC');
  });

  it('A29②：alice 用「仅自己」私有表引用同组织可见行 X → bob 看 X 的反向面板看不到该私有来源，alice 表主本人能看到（正反成对）', async () => {
    // 判定口径（合同写死）：backref 来源表 visibility='private' 且 owner_member_id ≠ 请求者 → 从反向面板剔除；表主本人不剔除。
    // 同组织（alice/bob 同 A 企业）；X 在 org 可见表 T，bob 可读；alice 私有表 P 引用 X。
    const tableT = (await createSimpleTable(seed.aliceCookie, `A29-T-${seed.sfx}`, 'org')).body.data
      .table_id;
    const rowX = (await seedTitledRow(seed.aliceCookie, tableT, '被引用行X')).rowId;
    const tableP = (await createSimpleTable(seed.aliceCookie, `A29-私有P-${seed.sfx}`, 'private')).body
      .data.table_id;
    await addRelationField(seed.aliceCookie, tableP, tableT, '私有引用');
    const pRelField = (await fieldIdOf(seed.aliceCookie, tableP, 'relation'))!;
    const pRow = (await seedRow(seed.aliceCookie, tableP))!;
    await patchRow(seed.aliceCookie, pRow, 1, { [pRelField]: [rowX] });
    // bob 视角：看不到来自 alice 私有表 P 的反向引用（零泄露）
    const bobView = await getBackrefs(seed.bobCookie, rowX);
    expect(bobView.status).toBe(200);
    expect(bobView.body.data.backrefs.some((r: { table_id: string }) => r.table_id === tableP)).toBe(
      false
    );
    // alice 表主视角：能看到自己私有表 P 的反向引用（正向对照，堵「一律空」假绿）
    const aliceView = await getBackrefs(seed.aliceCookie, rowX);
    expect(aliceView.status).toBe(200);
    expect(aliceView.body.data.backrefs.some((r: { table_id: string }) => r.table_id === tableP)).toBe(
      true
    );
  });

  it('P2 注入对抗面：relation 值塞非 uuid / SQL 片段 → 400 VALIDATION_FAILED（用户输入不进标识符位，深校验拒）', async () => {
    const patched = await patchRow(seed.aliceCookie, (await seedRow(seed.aliceCookie, aTable))!, 1, {
      [aRelField]: ["'; DROP TABLE zenithjoy.db_rows; --", 'not-a-uuid'],
    });
    expect(patched.status).toBe(400);
    expect(patched.body?.error?.code).toBe('VALIDATION_FAILED');
  });
});
