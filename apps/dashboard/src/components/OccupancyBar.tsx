/**
 * 24 小时占用条（Brain task fdbd0238）
 *
 * 主理人：「我觉得你这个不是很明显。比如说应该是左边是一个已经排的东西，然后右边是不是
 * 能够看出这几个地方是空的、空的、空的？你现在写的这我也不知道他妈的能空多少、差多少，
 * 你知道吧？就很烦，不明显。」
 *
 * 上一版把空档写成表里一行字。19 分钟和 3 小时在表里长得一样高，扫一眼分不出哪块大。
 * 所以这里用长度说话：涂色的是占住的，留白的就是空的，多空一眼看得出。
 */
import { slotsOfDay, dayRange, type Dept, type ScheduleSlot } from '../api/schedule.api';
import { DEPT_BLOCK } from './dept-colors';
import { fitCount, gapText } from './schedule-gaps';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** 小于这个的空白在条上写不下字（620px 高的条上 30 分钟约 13px） */
export const BAR_LABEL_MIN_MINUTES = 30;

/**
 * 两段占用之间小于这个的缝，在条上并进占用块。
 * 触达是 20 单一天、单与单之间隔十几二十分钟；不合并的话上午那片会变成一堆
 * 分不清的横条纹，反而看不出哪儿真的空着。小缝的精确数字表格里有。
 */
export const BAR_MERGE_GAP_MINUTES = 30;

export interface BarSegment {
  kind: 'busy' | 'free';
  /** 距条顶的百分比 */
  topPct: number;
  /** 占条高的百分比 */
  heightPct: number;
  minutes: number;
  startText: string;
  endText: string;
  /** 这段占用里排头那件活的部门，用来上色 */
  dept?: Dept;
  /** 空白段：已经过去了，加不进去 */
  past?: boolean;
  /** 空白段：还能塞几单 */
  canFit?: number;
  /** 空白段：够大到能在条上写字 */
  showLabel?: boolean;
  /** 段起始的毫秒时刻，点它时把表格滚过去 */
  startMs: number;
}

function hhmm(t: number, dayEnd: number): string {
  if (t >= dayEnd) return '24:00';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 把一天切成占用段与空白段，交替铺满 00:00–24:00。
 *
 * 时间上挨着或重叠的活先合并再画：一台机同一时刻只有一个前台，
 * 每件活画一段会把 20 单触达变成 20 条细线，反而看不出哪儿空。
 */
export function segments(slots: ScheduleSlot[], dayOffset: number, now: number = Date.now()): BarSegment[] {
  const { start: dayStart, end: dayEnd } = dayRange(dayOffset);
  const items = slotsOfDay(slots, dayOffset)
    .map((s) => {
      const start = new Date(s.planned_at).getTime();
      return { start, end: Math.min(start + s.est_minutes * MINUTE, dayEnd), dept: s.dept };
    })
    .sort((a, b) => a.start - b.start);

  // 合并连续、重叠、以及只隔了小缝的占用
  const busy: { start: number; end: number; dept: Dept }[] = [];
  for (const it of items) {
    const last = busy[busy.length - 1];
    if (last && it.start - last.end < BAR_MERGE_GAP_MINUTES * MINUTE) last.end = Math.max(last.end, it.end);
    else busy.push({ start: it.start, end: it.end, dept: it.dept });
  }

  const out: BarSegment[] = [];
  const pct = (ms: number) => ((ms - dayStart) / (DAY_MINUTES * MINUTE)) * 100;
  const emit = (kind: 'busy' | 'free', start: number, end: number, past: boolean, dept?: Dept) => {
    const minutes = Math.round((end - start) / MINUTE);
    if (minutes <= 0) return;
    out.push({
      kind,
      topPct: pct(start),
      heightPct: (minutes / DAY_MINUTES) * 100,
      minutes,
      startText: hhmm(start, dayEnd),
      endText: hhmm(end, dayEnd),
      dept,
      startMs: start,
      ...(kind === 'free'
        ? { past, canFit: past ? 0 : fitCount(minutes), showLabel: minutes >= BAR_LABEL_MIN_MINUTES }
        : {}),
    });
  };
  /** 横跨此刻的空白切成两截：灰的是过去了的，蓝的才是还能加的 */
  const push = (kind: 'busy' | 'free', start: number, end: number, dept?: Dept) => {
    if (kind === 'free' && now > start && now < end) {
      emit('free', start, now, true);
      emit('free', now, end, false);
      return;
    }
    emit(kind, start, end, kind === 'free' && end <= now, dept);
  };

  let cursor = dayStart;
  for (const b of busy) {
    if (b.start > cursor) push('free', cursor, b.start);
    push('busy', Math.max(cursor, b.start), b.end, b.dept);
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < dayEnd) push('free', cursor, dayEnd);
  return out;
}

export interface OccupancyBarProps {
  slots: ScheduleSlot[];
  dayOffset: number;
  /** 点空白段时把表格滚到这个时刻 */
  onPickGap?: (startMs: number) => void;
}

export default function OccupancyBar({ slots, dayOffset, onPickGap }: OccupancyBarProps) {
  const segs = segments(slots, dayOffset);
  const free = segs.filter((s) => s.kind === 'free' && !s.past);
  const freeMinutes = free.reduce((n, s) => n + s.minutes, 0);
  const canAdd = free.reduce((n, s) => n + (s.canFit ?? 0), 0);
  const isToday = dayOffset === 0;
  const nowPct = ((Date.now() - dayRange(0).start) / (DAY_MINUTES * MINUTE)) * 100;

  return (
    <div className="flex w-[124px] shrink-0 flex-col">
      <div data-testid="bar-head" className="mb-1 px-1 text-[11px] leading-tight text-gray-500">
        <div>
          空 <b className="text-blue-600">{gapText(freeMinutes)}</b>
        </div>
        <div>
          还能加 <b className="text-blue-600">{canAdd}</b> 单
        </div>
      </div>

      <div className="relative flex-1">
        {/* 左边一列刻度，每 3 小时一个 */}
        <div className="absolute inset-y-0 left-0 w-[18px]">
          {Array.from({ length: 9 }, (_, i) => i * 3).map((h) => (
            <span
              key={h}
              data-testid="bar-tick"
              className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-gray-400"
              style={{ top: `${(h / 24) * 100}%` }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>

        <div className="absolute inset-y-0 left-[22px] right-0 overflow-hidden rounded-md border bg-white">
          {segs.map((s) =>
            s.kind === 'busy' ? (
              <div
                key={`b-${s.startMs}`}
                data-testid="bar-busy"
                title={`${s.startText}–${s.endText} 排了活`}
                className={`absolute inset-x-0 ${s.dept ? DEPT_BLOCK[s.dept].bar : 'bg-gray-400'}`}
                style={{ top: `${s.topPct}%`, height: `${s.heightPct}%` }}
              />
            ) : (
              <button
                key={`f-${s.startMs}`}
                data-testid="bar-free"
                data-past={s.past ? '1' : '0'}
                title={
                  s.past
                    ? `${s.startText}–${s.endText} 空 ${gapText(s.minutes)}（已过）`
                    : `${s.startText}–${s.endText} 空 ${gapText(s.minutes)}，还能插 ${s.canFit} 单`
                }
                onClick={() => onPickGap?.(s.startMs)}
                className={`absolute inset-x-0 flex items-center justify-center px-1 text-[10px] leading-tight ${
                  s.past ? 'cursor-default bg-gray-50 text-gray-300' : 'bg-blue-50/60 text-blue-700 hover:bg-blue-100'
                }`}
                style={{ top: `${s.topPct}%`, height: `${s.heightPct}%` }}
              >
                {s.showLabel && (
                  <span className="flex flex-col items-center leading-[1.15]">
                    <span className="whitespace-nowrap">空 {gapText(s.minutes)}</span>
                    {/* 块够高才写第二行，不然两行会把块撑出边界 */}
                    {!s.past && s.canFit ? (
                      s.minutes >= 90 ? <span className="font-medium">能插 {s.canFit} 单</span> : null
                    ) : null}
                  </span>
                )}
              </button>
            ),
          )}

          {isToday && (
            <div
              data-testid="bar-now"
              className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500"
              style={{ top: `${nowPct}%` }}
            >
              <span className="absolute -top-[3px] -left-[1px] h-[6px] w-[6px] rounded-full bg-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
