/**
 * S2 行层组织隔离 · 行回收站 · JSON 导出 · 对抗输入
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_rows：软删/还原/导出全部真库真验，物理行计数亲自数；
 *   - workbenchAuthGuard ↔ 行路由：跨组织用 B 企业的真会话，不伪造 orgId。
 *
 * 隔离断言一律正反成对（合同 INV-3 / 上位合同 A3）：只写反向 404 会被「一律拒绝」的假绿骗过。
 *
 * TDD Red：行端点族在 origin/main 上不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createRow,
  patchRow,
  deleteRow,
  listRows,
  listRowTrash,
  restoreRow,
  pasteRows,
  exportTable,
  fieldIdOf,
  type TwoTenantSeed,
} from './_rows-fixture';

let seed: TwoTenantSeed;
let tableId: string;
let textFieldId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-ISO');
  const t = await createTable(seed.aliceCookie, `隔离表-${seed.sfx}`, 'org');
  tableId = t.body?.data?.table_id;
  textFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'text');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S2 行层隔离与数据主权 [BEHAVIOR]', () => {
  it('跨组织改行返 404 且原行逐字未变', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    await patchRow(seed.aliceCookie, rowId, 1, { [textFieldId]: 'A 企业的值' });

    const before = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);

    // 丙是 B 企业员工，持真会话（不是没登录）——这一条测的是隔离，不是鉴权
    const patched = await patchRow(seed.carolCookie, rowId, 2, { [textFieldId]: '越权写入' });
    expect(patched.status).toBe(404);
    const deleted = await deleteRow(seed.carolCookie, rowId);
    expect(deleted.status).toBe(404);
    const restored = await restoreRow(seed.carolCookie, rowId);
    expect(restored.status).toBe(404);
    const listed = await listRows(seed.carolCookie, tableId);
    expect(listed.status).toBe(404);
    const exported = await exportTable(seed.carolCookie, tableId);
    expect(exported.status).toBe(404);

    const after = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);
    expect(after.rows[0].data).toEqual(before.rows[0].data);

    // 不可达与不存在必须逐字节同形，否则可以逐个 id 试出他企业有哪些表
    const random = await listRows(seed.carolCookie, '11111111-2222-3333-4444-555555555555');
    expect(JSON.stringify(listed.body)).toBe(JSON.stringify(random.body));
  });

  it('本组织正向读得到自己的行', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;

    // 与上一条在同一 suite 内成对存在：全端点一律 404 的实现会在这里当场翻车
    const listed = await listRows(seed.aliceCookie, tableId);
    expect(listed.status).toBe(200);
    expect(listed.body.data.rows.map((r: { row_id: string }) => r.row_id)).toContain(rowId);

    const patched = await patchRow(seed.aliceCookie, rowId, 1, { [textFieldId]: '自己写的' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.data[textFieldId]).toBe('自己写的');
  });

  it('删行软删物理行仍在', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;

    const before = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1',
      [tableId]
    );
    const res = await deleteRow(seed.aliceCookie, rowId);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted_at).toBeTruthy();

    const after = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1',
      [tableId]
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const listed = await listRows(seed.aliceCookie, tableId);
    expect(listed.body.data.rows.map((r: { row_id: string }) => r.row_id)).not.toContain(rowId);

    const trash = await listRowTrash(seed.aliceCookie, tableId);
    expect(trash.status).toBe(200);
    const entry = trash.body.data.rows.find((r: { row_id: string }) => r.row_id === rowId);
    expect(entry).toBeTruthy();
    // 30 天窗口复用 Sprint A 的 TRASH_RETENTION_DAYS，不新造常量
    const days =
      (new Date(entry.restorable_until).getTime() - new Date(entry.deleted_at).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('还原后全字段逐字回归', async () => {
    const created = await createRow(seed.aliceCookie, tableId);
    const rowId = created.body.data.row_id;
    await patchRow(seed.aliceCookie, rowId, 1, { [textFieldId]: '删前的值' });
    const before = await seed.client.query('SELECT data FROM zenithjoy.db_rows WHERE id = $1', [rowId]);

    await deleteRow(seed.aliceCookie, rowId);
    const res = await restoreRow(seed.aliceCookie, rowId);
    expect(res.status).toBe(200);

    const after = await seed.client.query(
      'SELECT data, deleted_at FROM zenithjoy.db_rows WHERE id = $1',
      [rowId]
    );
    expect(after.rows[0].data).toEqual(before.rows[0].data);
    expect(after.rows[0].deleted_at).toBeNull();

    const listed = await listRows(seed.aliceCookie, tableId);
    expect(listed.body.data.rows.map((r: { row_id: string }) => r.row_id)).toContain(rowId);
  });

  it('导出行数与库一致且零他组织数据', async () => {
    const t = await createTable(seed.aliceCookie, `导出表-${seed.sfx}`, 'org');
    const tid = t.body.data.table_id;
    await pasteRows(seed.aliceCookie, tid, ['字段-text'], [['e1'], ['e2']]);
    const dropped = await createRow(seed.aliceCookie, tid);
    await deleteRow(seed.aliceCookie, dropped.body.data.row_id);

    // B 企业也有自己的表和行，导出体里不许出现它任何痕迹
    const bTable = await createTable(seed.carolCookie, `他家表-${seed.sfx}`, 'org');
    await pasteRows(seed.carolCookie, bTable.body.data.table_id, ['字段-text'], [['他家的值']]);

    const res = await exportTable(seed.aliceCookie, tid);
    expect(res.status).toBe(200);

    const db = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_rows r WHERE r.table_id = $1 AND r.deleted_at IS NULL',
      [tid]
    );
    expect(res.body.data.rows).toHaveLength(db.rows[0].n);
    expect(res.body.data.table_id).toBe(tid);
    expect(res.body.data.fields).toHaveLength(8); // 粘贴的列名与既有字段逐字相等 → 复用，不新建

    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(seed.orgBTenantId);
    expect(dump).not.toContain('他家的值');
    expect(dump).not.toContain(dropped.body.data.row_id);
  });

  it('对抗输入作为数据值落库且表清单未变', async () => {
    const tid = (await createTable(seed.aliceCookie, `对抗表-${seed.sfx}`, 'org')).body.data.table_id;
    const listTables = async () => {
      const r = await seed.client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'zenithjoy' ORDER BY table_name"
      );
      return r.rows.map((x: { table_name: string }) => x.table_name);
    };
    const before = await listTables();

    const payloads = [
      '<img src=x onerror=alert(1)>',
      '__proto__',
      'constructor',
      '"; DROP TABLE db_rows; --',
      '🧨'.repeat(200),
    ];
    for (const p of payloads) {
      const res = await pasteRows(seed.aliceCookie, tid, [p], [[p]]);
      // 允许 201（作为数据值收下）或 400（显式拒绝），唯独不许 5xx
      expect([201, 400], `payload 触发了 5xx：${p.slice(0, 20)}`).toContain(res.status);
      if (res.status === 201) {
        const fieldId = res.body.data.created_fields[0].field_id;
        const row = await seed.client.query(
          'SELECT r.data ->> $2 AS cell FROM zenithjoy.db_rows r WHERE r.id = $1',
          [res.body.data.row_ids[0], fieldId]
        );
        // 逐字保存：既没被转义成别的串，也没被当成指令执行
        expect(row.rows[0].cell).toBe(p);
      }
    }

    expect(await listTables()).toEqual(before);
    // 原型链未被 __proto__ 那条污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
