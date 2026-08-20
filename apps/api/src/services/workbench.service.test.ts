/**
 * 路③ service 的**纯输入校验**部分。
 *
 * 只测不碰 DB 的那一半：normalizeFields / isUuid / 两个常量。
 * 真正的落库语义（org_id 归属、软删物理行仍在、反枚举 404）由合同的真 Postgres 测试与
 * structured-workbench-smoke.sh 的真库真验覆盖 —— 那些边写在合同「禁 mock 边清单」里，
 * 不许拿 stub 出来的邻居冒充（stub 的邻居永远配合，真表才会翻脸）。
 */
import { describe, it, expect } from 'vitest';
import {
  FIELD_TYPES,
  TRASH_RETENTION_DAYS,
  normalizeFields,
  isUuid,
  WorkbenchValidationError,
} from './workbench.service';

describe('workbench.service 输入校验', () => {
  it('八类字段逐字且无重复', () => {
    expect([...FIELD_TYPES]).toEqual([
      'text',
      'long_text',
      'number',
      'date',
      'single_select',
      'multi_select',
      'person',
      'url',
    ]);
    expect(new Set(FIELD_TYPES).size).toBe(8);
  });

  it('回收站窗口是 30 天', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it('normalizeFields 补齐 options 与 display_order，缺省顺序按数组下标', () => {
    const out = normalizeFields([
      { name: 'a', field_type: 'text' },
      { name: 'b', field_type: 'single_select', options: ['x', 'y'] },
    ]);
    expect(out[0]).toEqual({ name: 'a', field_type: 'text', options: [], display_order: 0 });
    expect(out[1].options).toEqual(['x', 'y']);
    expect(out[1].display_order).toBe(1);
  });

  it('空/缺省 fields 视为空数组（模板建表走的就是这条）', () => {
    expect(normalizeFields(undefined)).toEqual([]);
    expect(normalizeFields(null)).toEqual([]);
    expect(normalizeFields([])).toEqual([]);
  });

  it('八类之外的 field_type 一律拒绝 —— 放过去只会被 DB 的 CHECK 约束打成 500', () => {
    expect(() => normalizeFields([{ name: 'x', field_type: 'checkbox' }])).toThrow(
      WorkbenchValidationError
    );
    expect(() => normalizeFields([{ name: 'x', field_type: '' }])).toThrow(WorkbenchValidationError);
  });

  it('缺 name 的字段拒绝；非数组的 fields 拒绝', () => {
    expect(() => normalizeFields([{ field_type: 'text' }])).toThrow(WorkbenchValidationError);
    expect(() => normalizeFields({ name: 'x' })).toThrow(WorkbenchValidationError);
  });

  it('字段名里的对抗字符原样保留 —— 它是数据值，永远不进标识符位', () => {
    const evil = `"; DROP TABLE db_rows; --`;
    expect(normalizeFields([{ name: evil, field_type: 'text' }])[0].name).toBe(evil);
    expect(normalizeFields([{ name: '__proto__', field_type: 'text' }])[0].name).toBe('__proto__');
  });

  it('isUuid 只认标准 uuid，杂串一律当"不存在"而不是让 SQL 抛 22P02', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid("1' OR '1'='1")).toBe(false);
  });
});
