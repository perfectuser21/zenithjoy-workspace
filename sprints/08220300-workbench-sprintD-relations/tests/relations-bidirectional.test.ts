/**
 * 路③ Sprint D · 双向可见 + 行选择器候选 + 反向引用 + Response Schema 纪律
 *
 * 覆盖断言：关联双向可见（A 关联 B → B 侧反查看得到）/ 行选择器候选端点 / 反向引用端点 /
 *          Response Schema 禁用字段名列全 + keys 完整性卡 + 反向断言。
 *
 * 禁 mock 边：代码 ↔ db_rows.data（真反查 JSONB）；route ↔ service（真调）。
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
  CANDIDATES_ENVELOPE_KEYS,
  CANDIDATE_ITEM_KEYS,
  CANDIDATE_ITEM_BANNED_KEYS,
  BACKREFS_ENVELOPE_KEYS,
  BACKREF_ITEM_KEYS,
  BACKREF_ITEM_BANNED_KEYS,
  type TwoTenantSeed,
} from './_relations-fixture';

describe('Sprint D 双向可见 + 行选择器候选 + 反向引用 [BEHAVIOR]', () => {
  let seed: TwoTenantSeed;
  let tableA: string;
  let tableB: string;
  let relFieldId: string;
  let aRow: string;
  let bRow1: string;
  let bRow2: string;

  beforeAll(async () => {
    seed = await seedTwoTenants('WB-DBIDIR');
    tableA = (await createSimpleTable(seed.aliceCookie, `A源-${seed.sfx}`, 'org')).body.data.table_id;
    tableB = (await createSimpleTable(seed.aliceCookie, `B目标-${seed.sfx}`, 'org')).body.data.table_id;
    bRow1 = (await seedTitledRow(seed.aliceCookie, tableB, '目标甲')).rowId;
    bRow2 = (await seedTitledRow(seed.aliceCookie, tableB, '目标乙')).rowId;
    await addRelationField(seed.aliceCookie, tableA, tableB);
    relFieldId = (await fieldIdOf(seed.aliceCookie, tableA, 'relation'))!;
    aRow = (await seedTitledRow(seed.aliceCookie, tableA, '来源行')).rowId;
    await patchRow(seed.aliceCookie, aRow, 2, { [relFieldId]: [bRow1] });
  });

  afterAll(async () => {
    await cleanupSeed(seed);
  });

  it('行选择器候选：返回 200，data keys 恰为 [candidates,field_id,target_table_id]，候选列出 B 表两条记录且带标题', async () => {
    const res = await getCandidates(seed.aliceCookie, tableA, relFieldId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(CANDIDATES_ENVELOPE_KEYS);
    expect(res.body.data.target_table_id).toBe(tableB);
    const cands = res.body.data.candidates;
    expect(cands.length).toBe(2);
    const ids = cands.map((c: { row_id: string }) => c.row_id).sort();
    expect(ids).toEqual([bRow1, bRow2].sort());
    const titles = cands.map((c: { title: string }) => c.title).sort();
    expect(titles).toEqual(['目标乙', '目标甲']);
  });

  it('候选记录 keys 恰为 [row_id,title]，禁用字段名一个不出现', async () => {
    const res = await getCandidates(seed.aliceCookie, tableA, relFieldId);
    for (const c of res.body.data.candidates) {
      expect(Object.keys(c).sort()).toEqual(CANDIDATE_ITEM_KEYS);
      for (const banned of CANDIDATE_ITEM_BANNED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(c, banned)).toBe(false);
      }
    }
  });

  it('双向可见：A 关联 B → 打开 B 记录反查，backref 列出 A 表名 + A 行标题 + 关联字段', async () => {
    const res = await getBackrefs(seed.aliceCookie, bRow1);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(BACKREFS_ENVELOPE_KEYS);
    expect(res.body.data.row_id).toBe(bRow1);
    const refs = res.body.data.backrefs;
    expect(refs.length).toBe(1);
    expect(refs[0].row_id).toBe(aRow);
    expect(refs[0].table_id).toBe(tableA);
    expect(refs[0].row_title).toBe('来源行');
    expect(refs[0].field_id).toBe(relFieldId);
    expect(typeof refs[0].table_name).toBe('string');
  });

  it('反向引用 keys 恰为五键，禁用字段名一个不出现', async () => {
    const res = await getBackrefs(seed.aliceCookie, bRow1);
    for (const r of res.body.data.backrefs) {
      expect(Object.keys(r).sort()).toEqual(BACKREF_ITEM_KEYS);
      for (const banned of BACKREF_ITEM_BANNED_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(r, banned)).toBe(false);
      }
    }
  });

  it('未被引用的目标行 backref 为空数组（不误报），被引用行才有 backref', async () => {
    const resEmpty = await getBackrefs(seed.aliceCookie, bRow2);
    expect(resEmpty.status).toBe(200);
    expect(resEmpty.body.data.backrefs).toEqual([]);
  });
});
