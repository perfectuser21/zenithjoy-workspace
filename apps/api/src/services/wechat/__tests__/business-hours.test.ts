/**
 * business-hours.test.ts — 营业时间窗口判定单测（含跨午夜）（Line 04）
 *
 * 对应 Golden Path Step 2 + 边界情况「营业时间外不自动回」。
 * 默认窗口 06:00–24:00；必须支持跨午夜（如 22:00–02:00）。
 * "24:00" 语义 = 当日 1440 分钟（直到午夜都算营业内）。
 *
 * 纯函数，环境无关 → 逻辑断言，CI 绿 = 真 done。
 *
 * 约定：isWithinBusinessHours(hhmm, start, end)
 *   - 普通窗口 start < end：[start, end) 半开区间（end 为上界，不含；"24:00"=1440 表示含到午夜前一刻）
 *   - 跨午夜 start > end：t >= start 或 t < end
 */
import { describe, it, expect } from 'vitest';
import { isWithinBusinessHours } from '../business-hours';

describe('isWithinBusinessHours [BEHAVIOR] 普通窗口 06:00–24:00（默认）', () => {
  it('营业起点 06:00 → 在内', () => {
    expect(isWithinBusinessHours('06:00', '06:00', '24:00')).toBe(true);
  });
  it('午夜前 23:59 → 在内（24:00 含到午夜）', () => {
    expect(isWithinBusinessHours('23:59', '06:00', '24:00')).toBe(true);
  });
  it('凌晨 00:00 / 05:59 → 不在内（营业开始前）', () => {
    expect(isWithinBusinessHours('00:00', '06:00', '24:00')).toBe(false);
    expect(isWithinBusinessHours('05:59', '06:00', '24:00')).toBe(false);
  });
});

describe('isWithinBusinessHours [BEHAVIOR] 跨午夜窗口 22:00–02:00', () => {
  it('午夜前 23:00 → 在内', () => {
    expect(isWithinBusinessHours('23:00', '22:00', '02:00')).toBe(true);
  });
  it('午夜后 01:00 → 在内', () => {
    expect(isWithinBusinessHours('01:00', '22:00', '02:00')).toBe(true);
  });
  it('窗口外 12:00 / 03:00 → 不在内', () => {
    expect(isWithinBusinessHours('12:00', '22:00', '02:00')).toBe(false);
    expect(isWithinBusinessHours('03:00', '22:00', '02:00')).toBe(false);
  });
  it('起点 22:00 含，终点 02:00 不含（半开区间）', () => {
    expect(isWithinBusinessHours('22:00', '22:00', '02:00')).toBe(true);
    expect(isWithinBusinessHours('02:00', '22:00', '02:00')).toBe(false);
  });
});
