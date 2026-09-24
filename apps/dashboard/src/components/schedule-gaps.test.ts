/**
 * 空档计算（Brain task b23aa7e0）
 *
 * 主理人：「这个效果已经很好了，但你让我感觉不到一个点——我的空白时间在哪？
 * 我这台手机还有哪些能给我安排进去的？哪些是空白点我可以再往里加的，还是说没有？」
 */
import { describe, it, expect } from 'vitest';
import { findGaps, SLOT_MINUTES, MIN_GAP_MINUTES, fitCount, headroomText } from './schedule-gaps';
import { dayRange, type ScheduleSlot } from '../api/schedule.api';

const HOUR = 3600_000;
const at = (hh: number, minutes: number, extra: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
  id: `s-${hh}-${minutes}-${extra.id ?? ''}`,
  title: `${hh} 点的活`,
  dept: '智能获客',
  planned_at: new Date(dayRange(0).start + hh * HOUR).toISOString(),
  est_minutes: minutes,
  source: 'recurring',
  status: 'queued',
  read_only: false,
  ...extra,
});

/** 固定一个"现在"，免得测试跟着真实时钟漂 */
const NOON = dayRange(0).start + 12 * HOUR;

describe('能塞几单', () => {
  it('按一单占的时间算，塞不下就是 0', () => {
    expect(fitCount(SLOT_MINUTES * 3)).toBe(3);
    expect(fitCount(SLOT_MINUTES - 1)).toBe(0);
    expect(fitCount(0)).toBe(0);
  });
});

describe('找空档', () => {
  it('两件活之间空着就是一个空档，算出空多久', () => {
    const gaps = findGaps([at(8, 60, { id: 'a' }), at(10, 60, { id: 'b' })], 0, NOON);
    const mid = gaps.find((g) => g.startText === '09:00');
    expect(mid).toBeDefined();
    expect(mid!.minutes).toBe(60);
    expect(mid!.endText).toBe('10:00');
  });

  it('一天的头和尾也算空档', () => {
    const gaps = findGaps([at(8, 60)], 0, NOON);
    expect(gaps[0].startText).toBe('00:00');
    expect(gaps[gaps.length - 1].endText).toBe('24:00');
  });

  it('活挨着排满就没有空档', () => {
    const full = Array.from({ length: 24 }, (_, h) => at(h, 60, { id: `h${h}` }));
    expect(findGaps(full, 0, NOON)).toHaveLength(0);
  });

  it('碎到塞不下一单的空隙不显示，免得刷屏', () => {
    // 08:00-08:10 与 08:12-08:22 之间只空 2 分钟
    const gaps = findGaps([at(8, 10, { id: 'a' }), { ...at(8, 10, { id: 'b' }), planned_at: new Date(dayRange(0).start + 8 * HOUR + 12 * 60_000).toISOString() }], 0, NOON);
    expect(gaps.every((g) => g.minutes >= MIN_GAP_MINUTES)).toBe(true);
    expect(gaps.some((g) => g.minutes === 2)).toBe(false);
  });

  it('重叠的活不会算出负数空档', () => {
    const gaps = findGaps([at(8, 600, { id: 'a' }), at(10, 60, { id: 'b' })], 0, NOON);
    expect(gaps.every((g) => g.minutes > 0)).toBe(true);
  });

  it('已经过去的空档标成已过，剩下的才算能加', () => {
    const gaps = findGaps([at(8, 60, { id: 'a' }), at(20, 60, { id: 'b' })], 0, NOON);
    const morning = gaps.find((g) => g.startText === '00:00')!;
    expect(morning.past).toBe(true);
    expect(morning.canFit).toBe(0); // 过去的加不进去了
    // 09:00–20:00 横跨此刻（12:00），被切成已过的一截和还能用的一截
    const gone = gaps.find((g) => g.startText === '09:00')!;
    const usable = gaps.find((g) => g.startText === '12:00')!;
    expect(gone.past).toBe(true);
    expect(gone.endText).toBe('12:00');
    expect(usable.past).toBe(false);
    expect(usable.canFit).toBeGreaterThan(0);
  });

  it('横跨此刻的空档切成两截，各自的区间与时长自洽', () => {
    // 11:00-14:00 空着，现在 12:00 → 切成 11:00-12:00（已过）与 12:00-14:00（还能用）
    // 不切会出现「11:00–14:00 空 2 小时」这种区间写三小时、数字写两小时的行
    const gaps = findGaps([at(10, 60, { id: 'a' }), at(14, 60, { id: 'b' })], 0, NOON);
    const gone = gaps.find((x) => x.startText === '11:00')!;
    const usable = gaps.find((x) => x.startText === '12:00')!;
    expect(gone.endText).toBe('12:00');
    expect(gone.minutes).toBe(60);
    expect(gone.past).toBe(true);
    expect(gone.canFit).toBe(0);
    expect(usable.endText).toBe('14:00');
    expect(usable.minutes).toBe(120);
    expect(usable.usableMinutes).toBe(120);
    expect(usable.canFit).toBe(fitCount(120));
  });

  it('看往后的日子时整天都算能加，不受此刻影响', () => {
    const tomorrow: ScheduleSlot = {
      ...at(8, 60),
      id: 'tmr',
      planned_at: new Date(dayRange(1).start + 8 * HOUR).toISOString(),
    };
    const gaps = findGaps([tomorrow], 1, NOON);
    expect(gaps.every((g) => !g.past)).toBe(true);
    expect(gaps[0].usableMinutes).toBe(gaps[0].minutes);
  });

  it('看过去的日子时整天都是已过，一单也加不进去', () => {
    const yest: ScheduleSlot = {
      ...at(8, 60),
      id: 'y',
      planned_at: new Date(dayRange(-1).start + 8 * HOUR).toISOString(),
    };
    const gaps = findGaps([yest], -1, NOON);
    expect(gaps.every((g) => g.past)).toBe(true);
    expect(gaps.reduce((n, g) => n + g.canFit, 0)).toBe(0);
  });

  it('这天一件活都没排，整天是一个大空档', () => {
    const gaps = findGaps([], 1, NOON);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startText).toBe('00:00');
    expect(gaps[0].endText).toBe('24:00');
  });
});

describe('还能加多少这句话', () => {
  it('空档够但额度不够时，报额度那个数', () => {
    // 时间能塞 60 单，额度只剩 41 → 卡住的是额度
    const t = headroomText(60, [{ dept: '智能获客', used: 14, cap: 55, unit: '单' }]);
    expect(t.limitedBy).toBe('额度');
    expect(t.canAdd).toBe(41);
    expect(t.quotaLeft).toBe(41);
  });

  it('额度够但时间不够时，报时间那个数', () => {
    const t = headroomText(5, [{ dept: '智能获客', used: 0, cap: 55, unit: '单' }]);
    expect(t.canAdd).toBe(5);
    expect(t.limitedBy).toBe('时间');
  });

  it('额度已经用满，一单也加不了', () => {
    const t = headroomText(30, [{ dept: '智能获客', used: 55, cap: 55, unit: '单' }]);
    expect(t.canAdd).toBe(0);
    expect(t.limitedBy).toBe('额度');
  });

  it('没有额度限制时只看时间', () => {
    const t = headroomText(7, []);
    expect(t.canAdd).toBe(7);
    expect(t.limitedBy).toBe('时间');
  });
});
