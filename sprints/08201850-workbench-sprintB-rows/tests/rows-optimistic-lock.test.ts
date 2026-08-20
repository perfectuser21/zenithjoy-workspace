/**
 * S2 行级 version 乐观锁 —— 别人同时改了同一格，你看到冲突提示而不是静默覆盖
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 行 version 状态机（读基线 → 带条件 UPDATE → 冲突分支）：两个**真并发请求**打真库，
 *     禁用「手工把 version 改掉再单发一个请求」这种伪并发——那测的是分支不是竞态；
 *   - 代码 ↔ zenithjoy.db_rows：真 UPDATE 真回读。
 *
 * TDD Red：`db_rows.version` 列与 PATCH 端点在 origin/main 上都不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createRow,
  patchRow,
  fieldIdOf,
  type TwoTenantSeed,
} from './_rows-fixture';

let seed: TwoTenantSeed;
let tableId: string;
let textFieldId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-LOCK');
  const t = await createTable(seed.aliceCookie, `并发表-${seed.sfx}`, 'org');
  tableId = t.body?.data?.table_id;
  textFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'text');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S2 行级乐观锁 [BEHAVIOR]', () => {
  it('成功 PATCH 后 version 恰加一', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    expect(created.body.data.version).toBe(1);

    const first = await patchRow(seed.aliceCookie, rowId, 1, { [textFieldId]: '第一次' });
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(2);

    const second = await patchRow(seed.aliceCookie, rowId, 2, { [textFieldId]: '第二次' });
    expect(second.status).toBe(200);
    expect(second.body.data.version).toBe(3);

    const db = await seed.client.query('SELECT version FROM zenithjoy.db_rows WHERE id = $1', [rowId]);
    expect(db.rows[0].version).toBe(3);
  });

  it('同基线并发提交恰一个 200 一个 409', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    const baseline = created.body.data.version;

    // 甲乙拿到同一个基线 version，同时提交同一格——两个请求真并发发出，不串行
    const [byAlice, byBob] = await Promise.all([
      patchRow(seed.aliceCookie, rowId, baseline, { [textFieldId]: '甲写的' }),
      patchRow(seed.bobCookie, rowId, baseline, { [textFieldId]: '乙写的' }),
    ]);

    const codes = [byAlice.status, byBob.status].sort();
    expect(codes, `并发结果=${JSON.stringify(codes)}（静默覆盖会得到 [200,200]）`).toEqual([200, 409]);

    const loser = byAlice.status === 409 ? byAlice : byBob;
    // 闸层的 409 是 MULTI_ORG_MEMBER，本端点的是 ROW_VERSION_CONFLICT，靠 code 分辨不靠状态码
    expect(loser.body.error.code).toBe('ROW_VERSION_CONFLICT');
  });

  it('409 时库中该格等于先提交者的值', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    const baseline = created.body.data.version;

    const [byAlice, byBob] = await Promise.all([
      patchRow(seed.aliceCookie, rowId, baseline, { [textFieldId]: '甲写的' }),
      patchRow(seed.bobCookie, rowId, baseline, { [textFieldId]: '乙写的' }),
    ]);

    const winnerValue = byAlice.status === 200 ? '甲写的' : '乙写的';
    const db = await seed.client.query(
      'SELECT r.data ->> $2 AS cell, r.version FROM zenithjoy.db_rows r WHERE r.id = $1',
      [rowId, textFieldId]
    );
    // 后到的那个必须一个字节都没写进去：这正是「静默覆盖」与「冲突可见」的分界
    expect(db.rows[0].cell).toBe(winnerValue);
    expect(db.rows[0].version).toBe(baseline + 1);
    expect([byAlice.status, byBob.status]).toContain(409);
  });

  it('基线 version 缺失或非数字返 400 而不是被当成放行', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;

    for (const bad of [undefined, null, 'abc'] as unknown[]) {
      const res = await patchRow(seed.aliceCookie, rowId, bad as number, { [textFieldId]: 'x' });
      expect(res.status, `version=${String(bad)} 应被拒`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });
});
