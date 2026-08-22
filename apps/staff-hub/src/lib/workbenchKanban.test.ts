/**
 * 看板纯逻辑单测 —— resolveDropPatch 必须映射**被拖那一行**，groupRowsByField 三态未分组
 *
 * 变异守卫的落点：
 *   - A24-drag-wrong-row 把 resolveDropPatch 改成恒返 rows[0] → 「映射被拖那一行」用例转红
 *     （smoke 的 --a24-pure-only 段跑本文件）
 *   - A20-ungrouped-null-only 由合同 views-group-type.test.ts 的三态用例守（此处再钉一遍作旁证）
 */
import { describe, it, expect } from 'vitest';
import { resolveDropPatch, groupRowsByField, UNGROUPED } from './workbenchKanban';

const mk = (row_id: string, value: unknown, version: number, order: number) => ({
  row_id,
  data: value === undefined ? {} : { fs: value },
  version,
  row_order: order,
  created_at: '',
  updated_at: '',
});

describe('workbenchKanban 纯逻辑', () => {
  it('resolveDropPatch 映射被拖那一行（不是列里第一行）', () => {
    const rows = [mk('r0', '甲', 3, 0), mk('r1', '乙', 7, 1), mk('r2', undefined, 5, 2)];
    const patch = resolveDropPatch(rows, 'r1', '甲', 'fs');
    expect(patch).not.toBeNull();
    expect(patch!.row_id, '拖的是 r1，恒返 rows[0] 会给出 r0').toBe('r1');
    expect(patch!.version, '带的是 r1 的基线 version').toBe(7);
    expect(patch!.data).toEqual({ fs: '甲' });
  });

  it('拖到未分组列清空该分组格', () => {
    const rows = [mk('r0', '甲', 3, 0), mk('r1', '乙', 7, 1)];
    const patch = resolveDropPatch(rows, 'r0', UNGROUPED, 'fs');
    expect(patch!.data).toEqual({ fs: null });
  });

  it('拖一张不存在的卡返 null（不误改任何行）', () => {
    const rows = [mk('r0', '甲', 3, 0)];
    expect(resolveDropPatch(rows, 'r-nope', '乙', 'fs')).toBeNull();
  });

  it('groupRowsByField 三态未分组：null 缺键 空串全归末列', () => {
    const rows = [mk('r-val', '甲', 1, 0), mk('r-null', null, 1, 1), mk('r-miss', undefined, 1, 2), mk('r-empty', '', 1, 3)];
    const cols = groupRowsByField(rows, 'fs', ['甲', '乙']);
    expect(cols.map((c) => c.column_value)).toEqual(['甲', '乙', UNGROUPED]);
    const byVal = Object.fromEntries(cols.map((c) => [c.column_value, c.row_ids]));
    expect(byVal['甲']).toEqual(['r-val']);
    expect([...byVal[UNGROUPED]].sort()).toEqual(['r-empty', 'r-miss', 'r-null']);
  });
});
