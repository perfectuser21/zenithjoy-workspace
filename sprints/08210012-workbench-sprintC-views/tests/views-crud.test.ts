/**
 * S3 视图 CRUD —— 视图 = zenithjoy.db_view_prefs 的一行（controller concern C1：复用既有表，不建 db_views）
 *
 * 禁 mock 边（合同 `## 禁 mock 边清单`）：
 *   - `routes/workbench.ts` ↔ `services/workbench-views.service.ts`：真调；
 *   - 代码 ↔ `zenithjoy.db_view_prefs`：真 INSERT / UPDATE / DELETE，真 SELECT 验落库；
 *   - 会话 → orgId/memberId → 视图归属这一跳全程真跑。
 *
 * TDD Red：`/api/knowledge/db/tables/:id/views` 与 `/views/:id` 端点族在 origin/main 上不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createView,
  listViews,
  patchView,
  deleteView,
  createRow,
  VIEW_KEYS,
  VIEW_BANNED_KEYS,
  type TwoTenantSeed,
} from './_views-fixture';

let seed: TwoTenantSeed;
let tableId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-VIEWS');
  const res = await createTable(seed.aliceCookie, `视图表-${seed.sfx}`, 'org');
  tableId = res.body?.data?.table_id;
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S3 视图 CRUD [BEHAVIOR]', () => {
  it('建视图返 201 且 keys 恰好十个，禁用字段名一个不出现，三键真落 db_view_prefs', async () => {
    const res = await createView(seed.aliceCookie, tableId, {
      name: '默认视图',
      view_type: 'grid',
      is_active: true,
    });
    expect(res.status, `建视图失败：${JSON.stringify(res.body)}`).toBe(201);

    const view = res.body.data as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);
    for (const banned of VIEW_BANNED_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(view, banned), `出现禁用字段名 ${banned}`).toBe(
        false
      );
    }
    expect(view.view_type).toBe('grid');
    expect(view.is_active).toBe(true);
    expect(view.degraded).toBe(false);
    expect(view.group_field_id).toBeNull();
    expect(view.filters).toEqual([]);
    expect(view.sorts).toEqual([]);
    expect(view.hidden_field_ids).toEqual([]);

    // 真落库 + 三键归属取自会话（不是请求体）
    const db = await seed.client.query(
      `SELECT org_id::text AS org_id, member_id, table_id::text AS table_id
         FROM zenithjoy.db_view_prefs WHERE id = $1`,
      [view.view_id]
    );
    expect(db.rowCount).toBe(1);
    expect(db.rows[0].org_id).toBe(seed.orgATenantId);
    expect(db.rows[0].member_id).toBe(seed.aliceOpenId);
    expect(db.rows[0].table_id).toBe(tableId);
  });

  it('GET views 纯读零写入副作用，空表返 views 空数组与 active_view_id 为 null', async () => {
    const empty = await createTable(seed.aliceCookie, `空视图表-${seed.sfx}`, 'org');
    const emptyTableId = empty.body?.data?.table_id as string;

    const first = await listViews(seed.aliceCookie, emptyTableId);
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.data).sort()).toEqual(['active_view_id', 'views']);
    expect(first.body.data.views).toEqual([]);
    expect(first.body.data.active_view_id).toBeNull();

    const before = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs WHERE table_id = $1',
      [emptyTableId]
    );
    for (let i = 0; i < 3; i += 1) {
      const again = await listViews(seed.aliceCookie, emptyTableId);
      expect(again.status).toBe(200);
    }
    const after = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs WHERE table_id = $1',
      [emptyTableId]
    );
    expect(after.rows[0].n, 'GET 有写入副作用（判定点 JC6：GET 必须纯读）').toBe(before.rows[0].n);
  });

  it('删视图只删偏好三表逐字不变，且 remaining 计数正确', async () => {
    const t = await createTable(seed.aliceCookie, `删视图表-${seed.sfx}`, 'org');
    const tid = t.body?.data?.table_id as string;
    await createRow(seed.aliceCookie, tid);

    const v1 = await createView(seed.aliceCookie, tid, {
      name: '视图一',
      view_type: 'grid',
      is_active: true,
    });
    const v2 = await createView(seed.aliceCookie, tid, { name: '视图二', view_type: 'grid' });

    const snapshot = async () => {
      const r = await seed.client.query(
        `SELECT md5(string_agg(x, '|')) AS h FROM (
           SELECT t.id::text || t.name AS x FROM zenithjoy.db_tables t WHERE t.org_id = $1
           UNION ALL SELECT f.id::text || f.name FROM zenithjoy.db_fields f WHERE f.org_id = $1
           UNION ALL SELECT r2.id::text || r2.data::text FROM zenithjoy.db_rows r2 WHERE r2.org_id = $1
           ORDER BY 1) s`,
        [seed.orgATenantId]
      );
      return r.rows[0].h as string;
    };

    const before = await snapshot();
    const del = await deleteView(seed.aliceCookie, v2.body.data.view_id);
    expect(del.status).toBe(200);
    expect(Object.keys(del.body.data).sort()).toEqual(['deleted_view_id', 'remaining']);
    expect(del.body.data.deleted_view_id).toBe(v2.body.data.view_id);
    expect(del.body.data.remaining).toBe(1);
    expect(await snapshot(), '删视图动了 db_tables / db_fields / db_rows').toBe(before);

    const gone = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs WHERE id = $1',
      [v2.body.data.view_id]
    );
    expect(gone.rows[0].n).toBe(0);
    const kept = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs WHERE id = $1',
      [v1.body.data.view_id]
    );
    expect(kept.rows[0].n).toBe(1);
  });

  it('删到最后一个视图返 400 LAST_VIEW_PROTECTED 且该行仍在', async () => {
    const t = await createTable(seed.aliceCookie, `保底视图表-${seed.sfx}`, 'org');
    const tid = t.body?.data?.table_id as string;
    const only = await createView(seed.aliceCookie, tid, {
      name: '唯一视图',
      view_type: 'grid',
      is_active: true,
    });
    const viewId = only.body?.data?.view_id as string;

    const res = await deleteView(seed.aliceCookie, viewId);
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe('LAST_VIEW_PROTECTED');

    const still = await seed.client.query(
      'SELECT count(*)::int AS n FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    expect(still.rows[0].n, '被拒的删除却把行删了').toBe(1);

    // is_active 置一清余：新建一个 active 视图后，老的必须变成 false（判定点 JC4）
    const second = await createView(seed.aliceCookie, tid, {
      name: '第二视图',
      view_type: 'grid',
      is_active: true,
    });
    expect(second.status).toBe(201);
    const list = await listViews(seed.aliceCookie, tid);
    const actives = (list.body.data.views as Array<{ is_active: boolean }>).filter(
      (v) => v.is_active
    );
    expect(actives.length, '同一表同一人出现了多个 active 视图').toBe(1);
    expect(list.body.data.active_view_id).toBe(second.body.data.view_id);

    // PATCH 也走同一条置一清余的路
    const back = await patchView(seed.aliceCookie, viewId, { is_active: true });
    expect(back.status).toBe(200);
    const list2 = await listViews(seed.aliceCookie, tid);
    expect(list2.body.data.active_view_id).toBe(viewId);
  });
});
