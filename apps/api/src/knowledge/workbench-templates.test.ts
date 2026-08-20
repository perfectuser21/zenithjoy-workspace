/**
 * 开箱模板的形状。模板声明是"一键建表落库结果"的唯一真相（A7 断言两者逐字相等），
 * 所以这里断言的是它自身的自洽性：数量下限、类型合法、顺序连续、key 唯一。
 */
import { describe, it, expect } from 'vitest';
import { WORKBENCH_TEMPLATES, findTemplate } from './workbench-templates';
import { FIELD_TYPES } from '../services/workbench.service';

describe('workbench-templates', () => {
  it('至少 2 个开箱模板（合同下限）', () => {
    expect(WORKBENCH_TEMPLATES.length).toBeGreaterThanOrEqual(2);
  });

  it('template_key 唯一 —— 撞 key 会让 findTemplate 静默取到另一张模板', () => {
    const keys = WORKBENCH_TEMPLATES.map((t) => t.template_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个模板的字段类型都在八类之内，display_order 从 0 连续递增', () => {
    for (const tpl of WORKBENCH_TEMPLATES) {
      expect(tpl.fields.length).toBeGreaterThan(0);
      tpl.fields.forEach((f, i) => {
        expect(FIELD_TYPES).toContain(f.field_type);
        expect(f.display_order).toBe(i);
        expect(f.name.length).toBeGreaterThan(0);
        // 选择类必须带选项，否则用户建完表面对一个选不了任何值的下拉框
        if (f.field_type === 'single_select' || f.field_type === 'multi_select') {
          expect(f.options.length).toBeGreaterThan(0);
        }
      });
    }
  });

  it('findTemplate 命中已知 key，未知 key 返回 undefined', () => {
    const first = WORKBENCH_TEMPLATES[0];
    expect(findTemplate(first.template_key)?.template_key).toBe(first.template_key);
    expect(findTemplate('no_such_template')).toBeUndefined();
  });
});
