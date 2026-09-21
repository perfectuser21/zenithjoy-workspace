/**
 * 空档计算 —— 回答「还能往哪加」（Brain task b23aa7e0）
 *
 * 主理人：「这个效果已经很好了，但你让我感觉不到一个点——我的空白时间在哪？
 * 我这台手机还有哪些能给我安排进去的？哪些是空白点我可以再往里加的，还是说没有？」
 *
 * 表里只列排了的活，空档是两行之间的时间差，得用眼睛算。这里把它算出来。
 */
import { slotsOfDay, dayRange, type DeptQuota, type ScheduleSlot } from '../api/schedule.api';

const MINUTE = 60_000;

/**
 * 一单实际占住多长时间。
 * 真机取样：单身 1–13 分钟，单与单之间还要隔 6–34 分钟（等页面加载、避免太密被风控）。
 * 只算单身会把「还能加 60 单」这种做不到的数报给主理人，所以按单身 + 间隔取 15 分钟。
 */
export const SLOT_MINUTES = 15;

/** 比这还碎的空隙塞不下一单，显示出来只会把表刷长 */
export const MIN_GAP_MINUTES = SLOT_MINUTES;

/** 这么长的空档能塞几单 */
export function fitCount(minutes: number): number {
  if (minutes < SLOT_MINUTES) return 0;
  return Math.floor(minutes / SLOT_MINUTES);
}

export interface Gap {
  /** 空档起止的毫秒时刻 */
  start: number;
  end: number;
  startText: string;
  /** 24:00 表示到当天结束 */
  endText: string;
  /** 空多久（分钟） */
  minutes: number;
  /** 已经过去了，加不进去 */
  past: boolean;
  /** 扣掉已过去那半截后还剩多久 */
  usableMinutes: number;
  /** 还能塞几单 */
  canFit: number;
}

function hhmm(t: number, dayEnd: number): string {
  if (t >= dayEnd) return '24:00';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 找出这天所有能用的空档。
 *
 * 相邻两件活之间、一天的头（00:00→首件）和尾（末件→24:00）都算。
 * 横跨此刻的空档只算此刻之后那半截——过去的时间加不进去了。
 *
 * @param now 传进来而不是直接读时钟，测试才不会跟着真实时间漂
 */
export function findGaps(slots: ScheduleSlot[], dayOffset: number, now: number = Date.now()): Gap[] {
  const { start: dayStart, end: dayEnd } = dayRange(dayOffset);
  const items = slotsOfDay(slots, dayOffset)
    .map((s) => {
      const start = new Date(s.planned_at).getTime();
      return { start, end: Math.min(start + s.est_minutes * MINUTE, dayEnd) };
    })
    .sort((a, b) => a.start - b.start);

  const out: Gap[] = [];
  const push = (start: number, end: number) => {
    const minutes = Math.round((end - start) / MINUTE);
    if (minutes < MIN_GAP_MINUTES) return;
    // 此刻之前的部分加不进去了
    const usableFrom = Math.max(start, now);
    const usableMinutes = Math.max(0, Math.round((end - usableFrom) / MINUTE));
    out.push({
      start,
      end,
      startText: hhmm(start, dayEnd),
      endText: hhmm(end, dayEnd),
      minutes,
      past: usableMinutes === 0,
      usableMinutes,
      canFit: fitCount(usableMinutes),
    });
  };

  let cursor = dayStart;
  for (const it of items) {
    if (it.start > cursor) push(cursor, it.start);
    cursor = Math.max(cursor, it.end); // 重叠的活不会倒退出负数空档
  }
  if (cursor < dayEnd) push(cursor, dayEnd);
  return out;
}

export interface Headroom {
  /** 最终还能加几单 */
  canAdd: number;
  /** 被什么卡住的 */
  limitedBy: '时间' | '额度';
  /** 额度还剩几单（没有额度限制时为 null） */
  quotaLeft: number | null;
}

/**
 * 把「还能加多少」算成一句话：时间能塞下的和额度还剩的，取小的那个。
 * 空档够但额度用完了，照样加不进去——这两条限制主理人都要看到。
 */
export function headroomText(fitByTime: number, quotas: DeptQuota[]): Headroom {
  if (quotas.length === 0) return { canAdd: fitByTime, limitedBy: '时间', quotaLeft: null };
  const quotaLeft = quotas.reduce((n, q) => n + Math.max(0, q.cap - q.used), 0);
  if (quotaLeft < fitByTime) return { canAdd: quotaLeft, limitedBy: '额度', quotaLeft };
  return { canAdd: fitByTime, limitedBy: '时间', quotaLeft };
}

/** 空多久写成人话 */
export function gapText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
