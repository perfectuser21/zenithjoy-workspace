import { describe, expect, it } from 'vitest';
import { lightStateColor } from './light-state-color';

describe('lightStateColor（灯态→实际颜色映射，用户拍板：绿=工作中/黄=等待/红=卡住/灰=空闲）', () => {
  it('work → 绿', () => {
    expect(lightStateColor('work')).toBe('#22c55e');
  });

  it('wait → 黄', () => {
    expect(lightStateColor('wait')).toBe('#eab308');
  });

  it('stuck → 红', () => {
    expect(lightStateColor('stuck')).toBe('#ef4444');
  });

  it('idle → 灰', () => {
    expect(lightStateColor('idle')).toBe('#9ca3af');
  });
});
