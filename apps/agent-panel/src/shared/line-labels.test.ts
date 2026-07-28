import { describe, it, expect } from 'vitest';
import { toBusinessLabel, assertNoInternalLineCode } from './line-labels';

describe('line-labels（客户视图业务语言映射，与services/agent同款判定点）', () => {
  it('line02 → 智能获客，line04 → 智能回复，publish → 智能发布', () => {
    expect(toBusinessLabel('line02')).toBe('智能获客');
    expect(toBusinessLabel('line04')).toBe('智能回复');
    expect(toBusinessLabel('publish')).toBe('智能发布');
  });

  it('未知代号安全兜底，不原样吐出', () => {
    expect(toBusinessLabel('line99')).not.toMatch(/line\d+/i);
  });

  it('assertNoInternalLineCode 能抓出混入的内部代号', () => {
    expect(assertNoInternalLineCode('智能回复正常')).toBe(true);
    expect(assertNoInternalLineCode('line04 stuck')).toBe(false);
  });
});
