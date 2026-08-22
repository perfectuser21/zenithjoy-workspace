/**
 * S3 视图层跨组织隔离 + 反查两分支 + 存 field_id + 审计（上位合同 A21 / A22 / A34 第五层）
 *
 * 隔离断言必须**成对**（合同 A3 正向对照）：只写反向 404 而不写正向 2xx，实现把所有视图端点
 * 一律返 404 也能全绿 —— 那是路① 已经踩过的假绿形态。
 *
 * 禁 mock 边：代码 ↔ `zenithjoy.db_view_prefs` / `db_fields` / `db_audit` 真读真写；
 * 双企业三身份走真会话 cookie，不伪造 cookie 串。
 *
 * TDD Red：视图端点族、`degraded` 字段、视图审计动作在 origin/main 上都不存在，本文件全红。
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
  fieldIdOf,
  randomUuid,
  type TwoTenantSeed,
} from './_views-fixture';

let seed: TwoTenantSeed;
let tableId: string;
let singleSelectFieldId: string;
let numberFieldId: string;
let viewId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-VISO');
  const t = await createTable(seed.aliceCookie, `隔离视图表-${seed.sfx}`, 'org');
  tableId = t.body?.data?.table_id;
  singleSelectFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'single_select');
  numberFieldId = await fieldIdOf(seed.aliceCookie, tableId, 'number');
  const v = await createView(seed.aliceCookie, tableId, {
    name: '我的视图',
    view_type: 'kanban',
    group_field_id: singleSelectFieldId,
    sorts: [{ field_id: numberFieldId, dir: 'desc' }],
    hidden_field_ids: [numberFieldId],
    is_active: true,
  });
  viewId = v.body?.data?.view_id;
});

afterAll(async () => {
  await cleanupSeed(seed);
});

describe('S3 视图隔离与反查降级 [BEHAVIOR]', () => {
  it('他企业会话读改删视图一律 404 同形', async () => {
    const before = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    const rnd = randomUuid();

    const foreignPatch = await patchView(seed.carolCookie, viewId, { name: '越权改名' });
    const randomPatch = await patchView(seed.carolCookie, rnd, { name: '越权改名' });
    const foreignDelete = await deleteView(seed.carolCookie, viewId);
    const foreignList = await listViews(seed.carolCookie, tableId);

    expect(foreignPatch.status).toBe(404);
    expect(randomPatch.status).toBe(404);
    expect(foreignDelete.status).toBe(404);
    expect(JSON.stringify(foreignPatch.body)).toBe(JSON.stringify(randomPatch.body));
    expect(JSON.stringify(foreignDelete.body)).toBe(JSON.stringify(randomPatch.body));
    // 表本身对他企业也不可达 → 视图列表同样 404 同形
    expect(foreignList.status).toBe(404);
    expect(JSON.stringify(foreignList.body)).toBe(JSON.stringify(randomPatch.body));

    const after = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    expect(after.rows[0].p, '越权请求改动了本组织的 prefs').toBe(before.rows[0].p);
  });

  /**
   * `db_view_prefs` 是 (org_id, table_id, member_id) 三键。只守 org 那一维时，
   * 「摘掉 member_id 条件」的变异会被 org_id 替它挡住 —— 那半边守卫是空的。
   * 而「我的视图被同事看到 / 被同事改掉」正是这张表存在的理由（PRD：换个会话重进还是**你上次那个**视图）。
   * 乙（bobCookie）与甲同组织不同 member，**对这张表本身有权访问**，所以这里红的只可能是 member 维。
   */
  it('同组织他人读改删本人视图一律 404 同形，且列表里零命中', async () => {
    const before = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    const rnd = randomUuid();

    const bobList = await listViews(seed.bobCookie, tableId);
    expect(bobList.status, '乙对这张表本身有权访问，视图列表应 200 而不是 404').toBe(200);
    const leaked = (bobList.body.data.views as Array<{ view_id: string }>).filter(
      (v) => v.view_id === viewId
    );
    expect(leaked.length, '甲的视图出现在乙的视图列表里 —— member 维隔离没立起来').toBe(0);
    expect(bobList.body.data.active_view_id).not.toBe(viewId);

    const bobPatch = await patchView(seed.bobCookie, viewId, { name: '同事越权改名' });
    const bobDelete = await deleteView(seed.bobCookie, viewId);
    const bobRandom = await patchView(seed.bobCookie, rnd, { name: '同事越权改名' });

    expect(bobPatch.status).toBe(404);
    expect(bobDelete.status).toBe(404);
    expect(bobRandom.status).toBe(404);
    expect(
      JSON.stringify(bobPatch.body),
      '同组织他人拿到的 404 与随机 uuid 不同形 —— 可比对字节分辨同事有没有这个视图'
    ).toBe(JSON.stringify(bobRandom.body));
    expect(JSON.stringify(bobDelete.body)).toBe(JSON.stringify(bobRandom.body));

    const after = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    expect(after.rows[0].p, '同组织他人的越权请求改动了本人的 prefs').toBe(before.rows[0].p);
  });

  it('本组织正向拿到自己的视图 —— 堵「一律 404」的假绿', async () => {
    const list = await listViews(seed.aliceCookie, tableId);
    expect(list.status).toBe(200);
    const mine = (list.body.data.views as Array<{ view_id: string }>).filter(
      (v) => v.view_id === viewId
    );
    expect(mine.length).toBe(1);
    expect(list.body.data.active_view_id).toBe(viewId);

    const patched = await patchView(seed.aliceCookie, viewId, { name: '改过的名字' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('改过的名字');

    const created = await createView(seed.aliceCookie, tableId, {
      name: '第二视图',
      view_type: 'grid',
    });
    expect(created.status).toBe(201);
    const deleted = await deleteView(seed.aliceCookie, created.body.data.view_id);
    expect(deleted.status).toBe(200);
  });

  it('已删字段的视图降级且 degraded 为 true', async () => {
    const t = await createTable(seed.aliceCookie, `降级视图表-${seed.sfx}`, 'org');
    const tid = t.body?.data?.table_id as string;
    const ssId = await fieldIdOf(seed.aliceCookie, tid, 'single_select');
    const numId = await fieldIdOf(seed.aliceCookie, tid, 'number');
    const v = await createView(seed.aliceCookie, tid, {
      name: '待降级视图',
      view_type: 'kanban',
      group_field_id: ssId,
      sorts: [{ field_id: ssId, dir: 'asc' }],
      hidden_field_ids: [ssId, numId],
      is_active: true,
    });
    const vid = v.body?.data?.view_id as string;

    // 前置状态：字段被删（Sprint A/B 未交付字段 DELETE 端点，见合同「未覆盖真实链路清单」）
    await seed.client.query('DELETE FROM zenithjoy.db_fields WHERE id = $1', [ssId]);

    const list = await listViews(seed.aliceCookie, tid);
    expect(list.status, '已删字段的视图反查必须 200 降级，不是 5xx 不是白屏').toBe(200);
    const view = (list.body.data.views as Array<Record<string, unknown>>).find(
      (x) => x.view_id === vid
    ) as Record<string, unknown>;
    expect(view).toBeTruthy();
    expect(view.degraded, 'degraded 未置 true —— 前端无从知道要出降级提示').toBe(true);
    expect(view.group_field_id).toBeNull();
    expect(view.sorts).toEqual([]);
    // 只剔除失效的那个，没失效的必须留着
    expect(view.hidden_field_ids).toEqual([numId]);

    // 读路径降级是无副作用的：库里那行原样保留（改的是读出来的东西，不是库）
    const raw = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [vid]
    );
    expect(raw.rows[0].p).toContain(ssId);
  });

  it('他企业 field_id 写入返 404 同形', async () => {
    const bTable = await createTable(seed.carolCookie, `他企业分组表-${seed.sfx}`, 'org');
    const bFieldId = await fieldIdOf(seed.carolCookie, bTable.body.data.table_id, 'single_select');
    expect(bFieldId).toBeTruthy();
    const rnd = randomUuid();

    const byForeign = await patchView(seed.aliceCookie, viewId, { group_field_id: bFieldId });
    const byRandom = await patchView(seed.aliceCookie, viewId, { group_field_id: rnd });

    expect(byForeign.status, '他企业真实 field_id 应 404（不许 400，那会泄露格式外的存在性差异）').toBe(
      404
    );
    expect(byRandom.status).toBe(404);
    expect(JSON.stringify(byForeign.body)).toBe(JSON.stringify(byRandom.body));
    expect(Object.prototype.hasOwnProperty.call(byForeign.body, 'timestamp')).toBe(false);

    // 404 优先于 400：既传他企业 field_id 又传非法类型，仍然是 404
    const both = await patchView(seed.aliceCookie, viewId, {
      view_type: 'kanban',
      group_field_id: bFieldId,
    });
    expect(both.status, '404 未优先于 400').toBe(404);
  });

  it('prefs 存 field_id 而非字段名，改显示名后视图不失效', async () => {
    const raw = await seed.client.query(
      'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
      [viewId]
    );
    const prefs = raw.rows[0].p as string;
    expect(prefs).toContain(singleSelectFieldId);
    expect(prefs, 'prefs 里存了字段显示名 —— 改个名视图就失效').not.toContain(
      '字段-single_select'
    );

    const before = await listViews(seed.aliceCookie, tableId);
    await seed.client.query('UPDATE zenithjoy.db_fields SET name = $2 WHERE id = $1', [
      singleSelectFieldId,
      '改过名的单选',
    ]);
    const after = await listViews(seed.aliceCookie, tableId);
    expect(JSON.stringify(after.body.data.views)).toBe(JSON.stringify(before.body.data.views));

    const view = (after.body.data.views as Array<Record<string, unknown>>).find(
      (x) => x.view_id === viewId
    ) as Record<string, unknown>;
    expect(view.group_field_id).toBe(singleSelectFieldId);
    expect(view.degraded).toBe(false);
  });

  it('视图三动作全部落 db_audit', async () => {
    const t = await createTable(seed.aliceCookie, `审计视图表-${seed.sfx}`, 'org');
    const tid = t.body?.data?.table_id as string;
    const v1 = await createView(seed.aliceCookie, tid, {
      name: '审计一',
      view_type: 'grid',
      is_active: true,
    });
    const v2 = await createView(seed.aliceCookie, tid, { name: '审计二', view_type: 'grid' });
    await patchView(seed.aliceCookie, v1.body.data.view_id, { name: '审计一改' });
    await deleteView(seed.aliceCookie, v2.body.data.view_id);

    const audit = await seed.client.query(
      `SELECT count(DISTINCT a.action)::int AS n
         FROM zenithjoy.db_audit a
        WHERE a.org_id = $1
          AND a.table_id = $2
          AND a.action IN ('create_view', 'update_view', 'delete_view')
          AND a.created_at > NOW() - interval '5 minutes'`,
      [seed.orgATenantId, tid]
    );
    expect(audit.rows[0].n, '视图建/改/删三种动作没有全部落 db_audit').toBe(3);

    // INV-5 日志脱敏同口径：审计只记 id 与动作，不记视图名正文
    const detail = await seed.client.query(
      `SELECT string_agg(a.detail::text, '|') AS d
         FROM zenithjoy.db_audit a
        WHERE a.org_id = $1 AND a.table_id = $2 AND a.action LIKE '%_view'`,
      [seed.orgATenantId, tid]
    );
    expect(String(detail.rows[0].d ?? '')).not.toContain('审计一');
  });
});
