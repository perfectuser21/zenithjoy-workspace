/**
 * 路③ Sprint E rollup 读服务的**纯逻辑**部分（test-pairing，无 DB）。
 *
 * 只测不碰 DB 的那一半：aggregate（六函数聚合 + Number() 数值规整 + 多值格式化 + degrade 语义）
 * 与 formatDisplay。真正的落库/读时聚合语义（org 隔离、失效降级三支、真 row_ids 顺 relation 捞值）
 * 由合同 `sprints/08222228-workbench-rollup-sprintE/tests/*.test.ts` 的真 Postgres 测试覆盖
 * ——那些边写在合同「禁 mock 边清单」里，不许拿 stub 出来的邻居冒充。
 */
import { describe, it, expect } from 'vitest';
import { aggregate, formatDisplay, type FieldPlan } from './workbench-rollup.service';

const rows = (vals: Array<Record<string, unknown>>) =>
  vals.map((data, i) => ({ id: `r${i}`, data }));

const plan = (fn: string, targetFieldId = 'amt', targetFieldType = 'number'): FieldPlan => ({
  fieldId: 'f',
  fn,
  degraded: false,
  relationFieldId: 'rel',
  targetTableId: 't',
  targetFieldId,
  targetFieldType,
});

describe('workbench-rollup.service 纯逻辑', () => {
  it('count：关联行数，非降级', () => {
    const out = aggregate(plan('count', ''), rows([{ amt: 10 }, { amt: 20 }, { amt: 30 }]));
    expect(out).toEqual({ value: 3, degraded: false });
  });

  it('sum：Number() 规整 string 数字计入（10 + 30 + "12" = 52），绝不字符串拼接', () => {
    const out = aggregate(plan('sum'), rows([{ amt: 10 }, { amt: 30 }, { amt: '12' }]));
    expect(out.value).toBe(52);
    expect(typeof out.value).toBe('number');
    expect(out.degraded).toBe(false);
  });

  it('sum：混入非数值行（abc）→ 跳过 + degraded=true，其余照常聚合', () => {
    const out = aggregate(plan('sum'), rows([{ amt: 10 }, { amt: 30 }, { amt: '12' }, { amt: 'abc' }]));
    expect(out.value).toBe(52);
    expect(out.degraded).toBe(true);
  });

  it('sum：空/缺值静默跳过、不算脏（不 degrade）', () => {
    const out = aggregate(plan('sum'), rows([{ amt: 10 }, { amt: '' }, {}]));
    expect(out).toEqual({ value: 10, degraded: false });
  });

  it('min / max：Number() 规整后取极值；全非数值 → null', () => {
    expect(aggregate(plan('min'), rows([{ amt: 10 }, { amt: '12' }, { amt: 30 }])).value).toBe(10);
    expect(aggregate(plan('max'), rows([{ amt: 10 }, { amt: '12' }, { amt: 30 }])).value).toBe(30);
    expect(aggregate(plan('min'), rows([{ amt: 'x' }])).value).toBeNull();
  });

  it('concat / lookup：多值按入参顺序 `, ` 拼接，跳过 null/空', () => {
    const p = plan('concat', 'title', 'text');
    expect(aggregate(p, rows([{ title: '甲' }, { title: '乙' }, { title: '丙' }])).value).toBe('甲, 乙, 丙');
    expect(aggregate(plan('lookup', 'title', 'text'), rows([{ title: '甲' }, { title: null }, { title: '丙' }])).value).toBe('甲, 丙');
  });

  it('未知 fn → 安全降级 null+degraded（不抛）', () => {
    expect(aggregate(plan('avg'), rows([{ amt: 1 }]))).toEqual({ value: null, degraded: true });
  });

  it('formatDisplay：date 截 YYYY-MM-DD、其余 String()、null/空回 null', () => {
    expect(formatDisplay('2026-08-23T10:00:00Z', 'date')).toBe('2026-08-23');
    expect(formatDisplay(42, 'number')).toBe('42');
    expect(formatDisplay('张三', 'person')).toBe('张三');
    expect(formatDisplay(null)).toBeNull();
    expect(formatDisplay('')).toBeNull();
    expect(formatDisplay(undefined)).toBeNull();
  });
});
