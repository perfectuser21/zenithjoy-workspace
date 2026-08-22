/**
 * 路③ 关联 service 纯逻辑单测（test-pairing / L3 无 DB）
 *
 * 候选/反查/隔离的**落库语义**在合同真库测试里（sprints/08220300-workbench-sprintD-relations/tests/*）。
 * 这里只钉两处纯函数：标题字段选取（display_order 最小 = 首个活字段）与显示标题回落规则——
 * 无值/空串一律回落 row_id（否则候选下拉会出现一排空标题，用户分不清挑的是哪条）。
 */
import { describe, it, expect } from 'vitest';
import { titleFieldOf, rowTitle } from './workbench-relations.service';
import type { FieldOut } from './workbench.service';

const f = (id: string, name: string, order: number): FieldOut => ({
  field_id: id,
  name,
  field_type: 'text',
  options: [],
  display_order: order,
});

describe('workbench-relations.service 纯逻辑', () => {
  it('titleFieldOf 取首个字段（listFieldRows 已按 display_order 升序 + 滤软删）', () => {
    expect(titleFieldOf([f('a', '标题', 0), f('b', '备注', 1)])?.field_id).toBe('a');
  });

  it('titleFieldOf 空字段集返回 undefined（无字段的表 → 标题回落 row_id）', () => {
    expect(titleFieldOf([])).toBeUndefined();
  });

  it('rowTitle 取标题字段值（字符串原样）', () => {
    const tf = f('a', '标题', 0);
    expect(rowTitle({ a: '目标甲' }, tf, 'row-1')).toBe('目标甲');
  });

  it('rowTitle 无标题字段 / null / undefined / 空串一律回落 row_id', () => {
    const tf = f('a', '标题', 0);
    expect(rowTitle({}, undefined, 'row-1')).toBe('row-1');
    expect(rowTitle({ a: null }, tf, 'row-2')).toBe('row-2');
    expect(rowTitle({}, tf, 'row-3')).toBe('row-3');
    expect(rowTitle({ a: '' }, tf, 'row-4')).toBe('row-4');
  });

  it('rowTitle 非字符串值转字符串（数字等不崩、不回落）', () => {
    const tf = f('a', '标题', 0);
    expect(rowTitle({ a: 42 }, tf, 'row-5')).toBe('42');
  });
});
