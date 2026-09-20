/**
 * 某台机某一天的纵向 24 小时日历（Brain task 12e6ed61）
 *
 * 主理人原话：「左边一个手机，右边是一个固定的窗口高度。你现在随着任务越来越多，
 * 这个页面越来越长，不是这个样子。应该是固定的高度，就是一页，中间有个可以拉的 bar。
 * 我们要的是类似 Calendar 那样子的——从上到下的时间分割，比如从 0 点到 8 点、10 点
 * 干啥、多少个任务，再拿部门一分，一个页面里面一个机器这样去看。」
 *
 * 所以：时间是画出来的（纵轴 0→24 点），重叠是排出来的（同时段自动分列并排），
 * 容器高度写死、内容自己滚，页面总高不随任务数增长。
 */
import { useEffect, useRef } from 'react';
import { slotsOfDay, backlogCount, dayRange, type ScheduleSlot } from '../api/schedule.api';
import { DEPT_BLOCK } from './dept-colors';
import { explainError } from '../api/error-codes';

/** 一小时对应多少像素。24 小时 = 960px，窗口露 620px——一眼能看到大半天，其余靠滚。 */
export const HOUR_PX = 40;
const DAY_PX = 24 * HOUR_PX;
/** 露出来的窗口高度，跟左边手机大致齐平 */
const VIEW_H = 620;
const MINUTE = 60_000;

const STATUS_STYLE: Record<ScheduleSlot['status'], { label: string; ring: string }> = {
  queued: { label: '待跑', ring: 'ring-gray-300' },
  running: { label: '进行中', ring: 'ring-amber-400' },
  done: { label: '已完成', ring: 'ring-emerald-400' },
  failed: { label: '失败', ring: 'ring-red-400' },
  blocked: { label: '被挡住', ring: 'ring-orange-400' },
};

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface CalBlock {
  slot: ScheduleSlot;
  /** 距日历顶部的像素 */
  top: number;
  /** 块高像素（已截断在当天之内） */
  height: number;
  /** 所在列，0 起 */
  col: number;
  /** 这一簇总共分几列 */
  cols: number;
  /** 是否跑到次日 */
  endsNextDay: boolean;
  /** 开始时刻 HH:MM */
  startText: string;
  /** 真实结束时刻 HH:MM（跨天时是次日的时刻） */
  endText: string;
}

/**
 * 把当天的活排成日历块。
 *
 * 分列规则：按开始时刻扫描，凡与前面还没结束的活有重叠就归进同一簇；
 * 簇内每个块找第一条「已经空出来」的列坐进去，坐不下才开新列。
 * 这样 A(9:00-10:00) / B(9:30-12:00) / C(10:00-11:00) 只用两列——C 复用 A 的列，
 * 不会因为簇里有三件活就把每块都压成三分之一宽。
 */
export function layout(slots: ScheduleSlot[], dayOffset: number): CalBlock[] {
  const { start: dayStart, end: dayEnd } = dayRange(dayOffset);

  const items = slotsOfDay(slots, dayOffset).map((s) => {
    const start = new Date(s.planned_at).getTime();
    const realEnd = start + s.est_minutes * MINUTE;
    return { slot: s, start, end: Math.min(realEnd, dayEnd), realEnd, endsNextDay: realEnd > dayEnd };
  });
  items.sort((a, b) => a.start - b.start || a.end - b.end);

  const out: CalBlock[] = [];
  const colEnds: number[] = [];
  let clusterStart = 0;
  let clusterMaxEnd = -Infinity;

  const closeCluster = (endIdx: number) => {
    for (let i = clusterStart; i < endIdx; i++) out[i].cols = colEnds.length;
  };

  items.forEach((it, i) => {
    // 跟前面那一簇彻底错开了 → 结算上一簇，开新簇
    if (i > 0 && it.start >= clusterMaxEnd) {
      closeCluster(i);
      colEnds.length = 0;
      clusterStart = i;
      clusterMaxEnd = -Infinity;
    }
    let col = colEnds.findIndex((e) => e <= it.start);
    if (col === -1) {
      colEnds.push(it.end);
      col = colEnds.length - 1;
    } else {
      colEnds[col] = it.end;
    }
    clusterMaxEnd = Math.max(clusterMaxEnd, it.end);
    out.push({
      slot: it.slot,
      top: ((it.start - dayStart) / (60 * MINUTE)) * HOUR_PX,
      height: Math.max(((it.end - it.start) / (60 * MINUTE)) * HOUR_PX, 18),
      col,
      cols: 1,
      endsNextDay: it.endsNextDay,
      startText: hhmm(it.start),
      endText: hhmm(it.realEnd),
    });
  });
  if (out.length > 0) closeCluster(out.length);
  return out;
}

export interface DayCalendarProps {
  slots: ScheduleSlot[];
  dayOffset: number;
  /** 这台机还没有排程数据（后端未接，或没给它排） */
  noSchedule?: boolean;
  quotas?: { dept: string; used: number; cap: number; unit: string }[];
}

export default function DayCalendar({ slots, dayOffset, noSchedule = false, quotas = [] }: DayCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = slotsOfDay(slots, dayOffset);
  const blocks = layout(slots, dayOffset);
  const done = today.filter((s) => s.status === 'done').length;
  const left = backlogCount(today);
  const bad = today.filter((s) => s.status === 'failed').length;

  const isToday = dayOffset === 0;
  const nowTop = ((Date.now() - dayRange(0).start) / (60 * MINUTE)) * HOUR_PX;

  // 换天时先滚到当前时刻附近，不用每次手动从 0 点往下拖
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = isToday ? Math.max(0, nowTop - VIEW_H / 3) : 8 * HOUR_PX;
  }, [dayOffset, isToday, nowTop]);

  return (
    <section data-testid="day-calendar" className="flex min-w-0 flex-1 flex-col rounded-xl border bg-white">
      <div
        data-testid="calendar-head"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2.5 text-xs text-gray-500"
      >
        <span className="text-sm font-medium text-gray-900">这天的安排</span>
        {quotas.map((q) => (
          <span key={q.dept}>
            {q.dept}{' '}
            <b className="text-gray-800">
              {q.used}/{q.cap}
              {q.unit}
            </b>
            <span className="ml-1 text-gray-400">还能加 {Math.max(0, q.cap - q.used)}</span>
          </span>
        ))}
        <span className="ml-auto">
          共 <b className="text-gray-800">{today.length}</b> 件 · 已完成 <b className="text-emerald-700">{done}</b> ·
          待跑 <b className="text-gray-800">{left}</b>
          {bad > 0 && (
            <>
              {' '}
              · 失败 <b className="text-red-600">{bad}</b>
            </>
          )}
        </span>
      </div>

      <div ref={scrollRef} data-testid="calendar-scroll" className="relative h-[620px] overflow-y-auto">
        <div className="relative" style={{ height: DAY_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              data-testid="hour-tick"
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: h * HOUR_PX }}
            >
              <span className="absolute -top-2 left-1 bg-white px-1 text-[11px] tabular-nums text-gray-400">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}

          {/* 活都画在标尺右边这块区域里，块的 left/width 是它的百分比 */}
          <div className="absolute inset-y-0 left-[52px] right-2">
            {blocks.map((b) => {
              const s = b.slot;
              const tone = DEPT_BLOCK[s.dept];
              const st = STATUS_STYLE[s.status];
              const err = s.status === 'failed' ? explainError('executor_lost') : null;
              const widthPct = 100 / b.cols;
              return (
                <div
                  key={s.id}
                  data-testid="cal-block"
                  data-status={s.status}
                  title={`${b.startText}–${b.endsNextDay ? '次日 ' : ''}${b.endText} ${s.title}`}
                  className={`absolute z-10 rounded-md px-2 py-1 text-[11px] ring-1 ${tone.bg} ${tone.text} ${st.ring}`}
                  style={{ top: b.top, height: b.height, left: `${b.col * widthPct}%`, width: `${widthPct}%` }}
                >
                  {/* 触达这类跑一整天的活，块有十几个小时高；文字 sticky 住才不会随滚动跑出视野。
                      块本身不能 overflow-hidden，否则 sticky 的标题会被自己的块裁掉。 */}
                  <div className={`sticky top-0 overflow-hidden rounded-t ${tone.bg}`}>
                    <div className="flex items-center gap-1">
                      <span className={`truncate font-medium ${s.status === 'done' ? 'line-through opacity-60' : ''}`}>
                        {s.title}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-white/70 px-1 text-[10px]">{st.label}</span>
                    </div>
                    <div className="truncate tabular-nums opacity-70">
                      {b.startText}–{b.endsNextDay ? `次日 ${b.endText}` : b.endText}
                      {s.source === 'oneoff' && ' · 单据'}
                    </div>
                  </div>
                  <div className="overflow-hidden">
                    {s.status === 'blocked' && (
                      <div className="truncate opacity-80">{s.blocked_reason || '前置条件没满足'}</div>
                    )}
                    {err && (
                      <div className="truncate text-red-700">
                        {err.label}：{err.hint}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isToday && (
            <div
              data-testid="now-line"
              className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500"
              style={{ top: nowTop }}
            >
              <span className="absolute -top-2 right-2 rounded bg-red-500 px-1 text-[10px] text-white">现在</span>
            </div>
          )}
        </div>

        {(noSchedule || today.length === 0) && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 z-30 -translate-y-1/2 text-center text-sm text-gray-400">
            <span className="rounded bg-white/90 px-3 py-1">{noSchedule ? '这台机还没有排程' : '这天没有安排'}</span>
          </div>
        )}
      </div>
    </section>
  );
}
