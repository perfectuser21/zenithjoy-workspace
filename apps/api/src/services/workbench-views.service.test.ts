/**
 * 路③ 视图 service 纯逻辑（test-pairing）—— 分组字段类型闸的判定顺序与错误分类
 *
 * 落库/隔离语义在合同真库测试里（sprints/08210012-.../tests/），本文件只钉 `resolveGroupField`
 * 这段纯逻辑：**404 优先于 400** 的死顺序（不属本表 → FieldNotFound；类型不符 → GroupFieldType；
 * 形态非法 → Validation），是变异 A20-group-type-nocheck 的注入点，在这里再钉一遍作 L3 旁证。
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGroupField,
  GroupFieldTypeError,
  LastViewProtectedError,
  isViewFieldNotFoundError,
} from './workbench-views.service';
import { WorkbenchValidationError, type FieldOut } from './workbench.service';

const SS = '11111111-1111-4111-8111-111111111111'; // single_select
const TXT = '22222222-2222-4222-8222-222222222222'; // text
const OTHER = '33333333-3333-4333-8333-333333333333'; // 合法 uuid 但不在本表

function fieldMap(): Map<string, FieldOut> {
  return new Map<string, FieldOut>([
    [SS, { field_id: SS, name: '单选', field_type: 'single_select', options: ['甲', '乙'], display_order: 0 }],
    [TXT, { field_id: TXT, name: '文本', field_type: 'text', options: [], display_order: 1 }],
  ]);
}

describe('workbench-views resolveGroupField 纯逻辑', () => {
  it('null / undefined → 不分组（返 null）', () => {
    expect(resolveGroupField(null, fieldMap())).toBeNull();
    expect(resolveGroupField(undefined, fieldMap())).toBeNull();
  });

  it('single_select 字段 → 返回该 field_id', () => {
    expect(resolveGroupField(SS, fieldMap())).toBe(SS);
  });

  it('非 UUID 形态（含 SQL 片段）→ 400 VALIDATION_FAILED（不牵涉存在性泄露）', () => {
    for (const bad of ['id; DROP TABLE', 'not-a-uuid', '123']) {
      expect(() => resolveGroupField(bad, fieldMap())).toThrow(WorkbenchValidationError);
    }
  });

  it('合法 UUID 但不属本表 → FieldNotFound（触发 404，优先于 400 类型闸）', () => {
    try {
      resolveGroupField(OTHER, fieldMap());
      throw new Error('应当抛错');
    } catch (e) {
      expect(isViewFieldNotFoundError(e)).toBe(true);
    }
  });

  it('属本表但类型非 single_select → GroupFieldTypeError（400）', () => {
    expect(() => resolveGroupField(TXT, fieldMap())).toThrow(GroupFieldTypeError);
  });
});

describe('workbench-views 错误分类', () => {
  it('LastViewProtectedError / GroupFieldTypeError 是具名 Error', () => {
    expect(new LastViewProtectedError()).toBeInstanceOf(Error);
    expect(new LastViewProtectedError().name).toBe('LastViewProtectedError');
    expect(new GroupFieldTypeError().name).toBe('GroupFieldTypeError');
  });

  it('isViewFieldNotFoundError 对无关错误返 false', () => {
    expect(isViewFieldNotFoundError(new Error('x'))).toBe(false);
    expect(isViewFieldNotFoundError(new WorkbenchValidationError('x'))).toBe(false);
  });
});
