import { describe, it, expect } from 'vitest';
import { toBusinessLabel, assertNoInternalLineCode } from '../shared/panel-line-labels';

// 客户视图严禁出现 line02/line04 这类内部代号（PrepPRD 判定点，非"客户视图脱敏"加厚项，
// 是桌面壳从第一天起就该说人话——这个面板唯一的观众是客户，没有"技术模式"可切换）
describe('panel-line-labels', () => {
  it('line02 → 智能获客', () => {
    expect(toBusinessLabel('line02')).toBe('智能获客');
  });

  it('line04 → 智能回复', () => {
    expect(toBusinessLabel('line04')).toBe('智能回复');
  });

  it('publish → 智能发布', () => {
    expect(toBusinessLabel('publish')).toBe('智能发布');
  });

  it('未知内部代号 → 安全兜底文案，绝不原样吐出', () => {
    const label = toBusinessLabel('line99');
    expect(label).not.toMatch(/line\d+/i);
  });

  it('assertNoInternalLineCode: 业务语言文案通过校验', () => {
    expect(assertNoInternalLineCode('智能回复正在处理')).toBe(true);
  });

  it('assertNoInternalLineCode: 混入 line02/line04 代号必须被抓出来', () => {
    expect(assertNoInternalLineCode('line04 正在处理')).toBe(false);
    expect(assertNoInternalLineCode('LINE02 evt')).toBe(false);
  });
});
