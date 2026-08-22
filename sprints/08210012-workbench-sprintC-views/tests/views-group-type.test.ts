/**
 * S3 分组字段类型闸 —— **只有 single_select 能做看板分组列**（controller concern C2 裁定）
 *
 * 为什么 multi_select 也 400：上位合同 §6 A20 原文只批「按**单选**字段分组」。多选分列意味着
 * 一行同时出现在多列，而「把这样一张卡拖到另一列」到底改哪个值，合同里没有定义 —— 让实现自行
 * 发挥的结果就是把用户的多选值悄悄改错，且没有任何断言抓得住（判定点 JC1）。
 *
 * 禁 mock 边：`routes/workbench.ts` ↔ `services/workbench-views.service.ts` 真调；
 * 代码 ↔ `zenithjoy.db_view_prefs` 真读真写（400 时必须逐字未变，靠真表比对才照得出）。
 *
 * TDD Red：视图端点族与类型闸在 origin/main 上都不存在，本文件全红。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  seedTwoTenants,
  cleanupSeed,
  createTable,
  createView,
  patchView,
  fieldIdOf,
  type TwoTenantSeed,
} from './_views-fixture';

/** 八类里除 single_select 之外的七类，逐个都必须被闸住 */
const NON_SINGLE_SELECT = [
  'text',
  'long_text',
  'number',
  'date',
  'multi_select',
  'person',
  'url',
] as const;

let seed: TwoTenantSeed;
let tableId: string;
let viewId: string;

beforeAll(async () => {
  seed = await seedTwoTenants('WB-VGRP');
  const t = await createTable(seed.aliceCookie, `分组闸表-${seed.sfx}`, 'org');
  tableId = t.body?.data?.table_id;
  const v = await createView(seed.aliceCookie, tableId, {
    name: '分组闸视图',
    view_type: 'grid',
    is_active: true,
  });
  viewId = v.body?.data?.view_id;
});

afterAll(async () => {
  await cleanupSeed(seed);
});

async function prefsOf(id: string): Promise<string> {
  const r = await seed.client.query(
    'SELECT prefs::text AS p FROM zenithjoy.db_view_prefs WHERE id = $1',
    [id]
  );
  return (r.rows[0]?.p ?? '') as string;
}

describe('S3 分组字段类型闸 [BEHAVIOR]', () => {
  it('七类非单选字段做分组一律 400 GROUP_FIELD_TYPE_INVALID', async () => {
    for (const fieldType of NON_SINGLE_SELECT) {
      const fieldId = await fieldIdOf(seed.aliceCookie, tableId, fieldType);
      expect(fieldId, `${fieldType} 字段缺 field_id`).toBeTruthy();

      const res = await patchView(seed.aliceCookie, viewId, {
        view_type: 'kanban',
        group_field_id: fieldId,
      });
      expect(
        res.status,
        `${fieldType} 做分组返 ${res.status}（controller C2：multi_select 也必须 400）`
      ).toBe(400);
      expect(res.body?.error?.code).toBe('GROUP_FIELD_TYPE_INVALID');
    }
  });

  it('single_select 做分组正向 200 —— 堵「一律 400」的假绿', async () => {
    const fieldId = await fieldIdOf(seed.aliceCookie, tableId, 'single_select');
    const res = await patchView(seed.aliceCookie, viewId, {
      view_type: 'kanban',
      group_field_id: fieldId,
    });
    expect(res.status, `single_select 做分组返 ${res.status}（应 200）`).toBe(200);
    expect(res.body.data.group_field_id).toBe(fieldId);
    expect(res.body.data.view_type).toBe('kanban');
    expect(res.body.data.degraded).toBe(false);

    const p = await prefsOf(viewId);
    expect(p).toContain(fieldId);
    expect(p).toContain('kanban');
  });

  it('400 时视图 prefs 逐字未变 —— 不进看板也不留半截状态', async () => {
    const t = await createTable(seed.aliceCookie, `半截状态表-${seed.sfx}`, 'org');
    const tid = t.body?.data?.table_id as string;
    const v = await createView(seed.aliceCookie, tid, {
      name: '半截状态视图',
      view_type: 'grid',
      is_active: true,
    });
    const vid = v.body?.data?.view_id as string;

    const before = await prefsOf(vid);
    for (const fieldType of NON_SINGLE_SELECT) {
      const fieldId = await fieldIdOf(seed.aliceCookie, tid, fieldType);
      const res = await patchView(seed.aliceCookie, vid, {
        view_type: 'kanban',
        group_field_id: fieldId,
      });
      expect(res.status).toBe(400);
    }
    const after = await prefsOf(vid);
    expect(after, '400 却把 view_type 改成了 kanban（留半截状态）').toBe(before);
    expect(after).toContain('grid');
  });

  /**
   * JC3 的护栏。「用户眼里的没值」在 JSONB 里有三种物理形态，只判 `null` 时另两态的卡片
   * 既不在任何选项列也不在未分组列 —— 卡片凭空消失，用户以为数据丢了。
   * 这是纯逻辑，放在合同测试里跑；变异 `A20-ungrouped-null-only` 把三态改回只判 null 时必须转红。
   * 用动态 import：模块还没写出来时只红这一条，不牵连本文件另外三条。
   */
  it('未分组三态：null 缺键 空串三行全归未分组列，有值行归其选项列', async () => {
    const { groupRowsByField } = await import('../../../apps/staff-hub/src/lib/workbenchKanban');
    const fid = 'f-single';
    const rows = [
      { row_id: 'r-val', data: { [fid]: '甲' }, version: 1, row_order: 0, created_at: '', updated_at: '' },
      { row_id: 'r-null', data: { [fid]: null }, version: 1, row_order: 1, created_at: '', updated_at: '' },
      { row_id: 'r-missing', data: {}, version: 1, row_order: 2, created_at: '', updated_at: '' },
      { row_id: 'r-empty', data: { [fid]: '' }, version: 1, row_order: 3, created_at: '', updated_at: '' },
    ];

    const columns = groupRowsByField(rows as never, fid, ['甲', '乙']);
    expect(columns.map((c: { column_value: string }) => c.column_value)).toEqual([
      '甲',
      '乙',
      '__ungrouped__',
    ]);

    const byValue = Object.fromEntries(
      columns.map((c: { column_value: string; row_ids: string[] }) => [c.column_value, c.row_ids])
    ) as Record<string, string[]>;
    expect(byValue['甲']).toEqual(['r-val']);
    expect(byValue['乙']).toEqual([]);
    expect(
      [...byValue.__ungrouped__].sort(),
      '三态未分组不齐 —— 只判 null 时缺键/空串的卡片会凭空消失（判定点 JC3）'
    ).toEqual(['r-empty', 'r-missing', 'r-null']);

    // 每一行恰好出现一次，不许既在选项列又在未分组列（单选分组下一行只能落一列）
    const all = columns.flatMap((c: { row_ids: string[] }) => c.row_ids);
    expect(all.length).toBe(rows.length);
    expect(new Set(all).size).toBe(rows.length);
  });
});
