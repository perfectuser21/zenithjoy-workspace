/**
 * 表级可见性（真访问控制而非显示过滤）+ 删表二次确认 + 软删回收站还原
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 代码 ↔ zenithjoy.db_tables / db_fields：软删语义必须真 Postgres 验
 *     （deleted_at 非空 **且物理行仍在**，物理 DELETE 与软删在 API 层看起来一模一样，
 *      只有查库才分得出来）。
 *
 * TDD Red：可见性判据、二次确认、回收站端点均不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import { seedTwoTenants, cleanupSeed, createTable, type TwoTenantSeed } from './_workbench-fixture';

let seed: TwoTenantSeed;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-VIS');
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('表级可见性「仅自己」是真访问控制 [BEHAVIOR]', () => {
  it('仅自己表对同组织他人不出现在列表', async () => {
    const created = await createTable(seed.aliceCookie, `私密-${seed.sfx}`, 'private');
    expect(created.status).toBe(201);
    const tableId = created.body.data.table_id;

    // 乙与甲同属 A 企业 —— 组织隔离过了，但表级可见性必须再拦一道
    const bobList = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.bobCookie);
    expect(bobList.status).toBe(200);
    expect(bobList.body.data.tables.map((t: { table_id: string }) => t.table_id)).not.toContain(tableId);

    const bobGet = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.bobCookie);
    const ghost = await request(app)
      .get('/api/knowledge/db/tables/00000000-0000-4000-8000-000000000000')
      .set('Cookie', seed.bobCookie);
    expect(bobGet.status).toBe(404);
    const strip = (b: Record<string, unknown>) => JSON.stringify({ ...b, timestamp: undefined });
    expect(strip(bobGet.body)).toBe(strip(ghost.body));
  });

  it('表主本人同时刻仍返 2xx 且内容逐字一致（防「一律拒绝」假绿）', async () => {
    const created = await createTable(seed.aliceCookie, `私密对照-${seed.sfx}`, 'private');
    const tableId = created.body.data.table_id;

    // 反向断言与正向对照必须在同一次运行内成对执行：
    // 只跑反向的话，把判据改成「对所有人一律 404」也能全绿。
    const bobGet = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.bobCookie);
    const aliceGet = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.aliceCookie);

    expect(bobGet.status).toBe(404);
    expect(aliceGet.status).toBe(200);
    expect(aliceGet.body.data.name).toBe(`私密对照-${seed.sfx}`);
    expect(aliceGet.body.data.fields.length).toBe(created.body.data.fields.length);
    expect(aliceGet.body.data.fields.map((f: { name: string }) => f.name)).toEqual(
      created.body.data.fields.map((f: { name: string }) => f.name)
    );

    const aliceList = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.aliceCookie);
    expect(aliceList.body.data.tables.map((t: { table_id: string }) => t.table_id)).toContain(tableId);
  });
});

describe('删表二次确认 + 软删可还原 [BEHAVIOR]', () => {
  it('确认名不匹配返 400 CONFIRM_MISMATCH 且不删', async () => {
    const created = await createTable(seed.aliceCookie, `待删-${seed.sfx}`, 'org');
    const tableId = created.body.data.table_id;

    const bad = await request(app)
      .delete(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.aliceCookie)
      .send({ confirm_name: `待删-${seed.sfx}-打错了` });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CONFIRM_MISMATCH');

    const row = await seed.client.query('SELECT deleted_at FROM zenithjoy.db_tables WHERE id = $1', [
      tableId,
    ]);
    expect(row.rows[0].deleted_at).toBeNull();
  });

  it('软删后物理行仍在且还原逐字回归', async () => {
    const created = await createTable(seed.aliceCookie, `回收-${seed.sfx}`, 'org');
    const tableId = created.body.data.table_id;
    const fieldsBefore = created.body.data.fields.map(
      (f: { name: string; field_type: string; display_order: number }) =>
        `${f.display_order}:${f.name}:${f.field_type}`
    );

    const countBefore = await seed.client.query(
      'SELECT count(*)::int AS c FROM zenithjoy.db_fields WHERE table_id = $1',
      [tableId]
    );

    const del = await request(app)
      .delete(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.aliceCookie)
      .send({ confirm_name: `回收-${seed.sfx}` });
    expect(del.status).toBe(200);

    // 软删 ≠ 物理删：deleted_at 非空，但表行与字段行一条都不许少
    const soft = await seed.client.query(
      'SELECT deleted_at FROM zenithjoy.db_tables WHERE id = $1',
      [tableId]
    );
    expect(soft.rowCount).toBe(1);
    expect(soft.rows[0].deleted_at).not.toBeNull();
    const countAfter = await seed.client.query(
      'SELECT count(*)::int AS c FROM zenithjoy.db_fields WHERE table_id = $1',
      [tableId]
    );
    expect(countAfter.rows[0].c).toBe(countBefore.rows[0].c);

    // 列表里消失，回收站里出现，且带 30 天窗口
    const list = await request(app).get('/api/knowledge/db/tables').set('Cookie', seed.aliceCookie);
    expect(list.body.data.tables.map((t: { table_id: string }) => t.table_id)).not.toContain(tableId);
    const trash = await request(app).get('/api/knowledge/db/trash').set('Cookie', seed.aliceCookie);
    const entry = trash.body.data.tables.find((t: { table_id: string }) => t.table_id === tableId);
    expect(entry).toBeDefined();
    const days =
      (new Date(entry.restorable_until).getTime() - new Date(entry.deleted_at).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    // 还原后表元数据 + 字段定义逐字回归
    const restore = await request(app)
      .post(`/api/knowledge/db/trash/${tableId}/restore`)
      .set('Cookie', seed.aliceCookie)
      .send({});
    expect(restore.status).toBe(200);
    const back = await request(app)
      .get(`/api/knowledge/db/tables/${tableId}`)
      .set('Cookie', seed.aliceCookie);
    expect(back.status).toBe(200);
    expect(back.body.data.name).toBe(`回收-${seed.sfx}`);
    expect(
      back.body.data.fields.map(
        (f: { name: string; field_type: string; display_order: number }) =>
          `${f.display_order}:${f.name}:${f.field_type}`
      )
    ).toEqual(fieldsBefore);
  });
});
