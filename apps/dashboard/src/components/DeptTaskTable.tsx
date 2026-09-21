/**
 * 某台机某一天的任务表，按部门分组（Brain task c6d5433e）
 *
 * 主理人原话：「我觉得一个 table 的形式会比较好，就直接都是那种 table。比如说我从早到晚
 * 怎么排序，每一个事情你分组一下，比如每个部门从早到晚是怎么排的，以 table 的形式去分。
 * 我一直在说，我们这一页的 table 你不要特别长让我去滑，页面的高度是定的就这一页，
 * 然后你在里面可以加一个上下滑杆。」
 *
 * 所以：一张表、按部门分段、组内从早到晚；容器高度写死、列头钉住、滚动发生在表里。
 */
import { useRef } from 'react';
import { slotsOfDay, backlogCount, dayRange, DEPTS, type Dept, type ScheduleSlot } from '../api/schedule.api';
import { DEPT_BLOCK } from './dept-colors';
import { explainError } from '../api/error-codes';
import { findGaps, headroomText, gapText, type Gap } from './schedule-gaps';
import OccupancyBar from './OccupancyBar';

/** 表格露出来的高度。内容再多也只在这块里滚，页面总高不变。 */
const VIEW_H = 620;
const MINUTE = 60_000;

const STATUS_STYLE: Record<ScheduleSlot['status'], { label: string; cls: string }> = {
  queued: { label: '待跑', cls: 'bg-gray-100 text-gray-600' },
  running: { label: '进行中', cls: 'bg-amber-100 text-amber-800' },
  done: { label: '已完成', cls: 'bg-emerald-100 text-emerald-800' },
  failed: { label: '失败', cls: 'bg-red-100 text-red-800' },
  blocked: { label: '被挡住', cls: 'bg-orange-100 text-orange-800' },
};

function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 任务的起止毫秒 */
function span(s: ScheduleSlot): { start: number; end: number } {
  const start = new Date(s.planned_at).getTime();
  return { start, end: start + s.est_minutes * MINUTE };
}

/**
 * 跟它同时在跑的其它活（时间区间有重叠即算并行）。
 * 跨部门一并判：一台机同一时刻只有一个前台，「触达跑着的时候插了条发布」才是真并行。
 */
export function parallelWith(s: ScheduleSlot, all: ScheduleSlot[]): ScheduleSlot[] {
  const a = span(s);
  return all.filter((o) => {
    if (o.id === s.id) return false;
    const b = span(o);
    return a.start < b.end && b.start < a.end;
  });
}

/** 时长写成人话：90 → 1小时30分 */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}

export interface DeptGroup {
  dept: Dept;
  items: ScheduleSlot[];
  total: number;
  done: number;
}

/**
 * 当天的活按部门分组，组内按开始时刻从早到晚。
 * 部门先后照 DEPTS 清单固定序——换一天看位置不跳，也和图例、筛选按钮同序。
 */
export function groupByDept(slots: ScheduleSlot[], dayOffset: number): DeptGroup[] {
  const today = slotsOfDay(slots, dayOffset);
  const out: DeptGroup[] = [];
  for (const dept of DEPTS) {
    const items = today
      .filter((s) => s.dept === dept)
      .sort((a, b) => new Date(a.planned_at).getTime() - new Date(b.planned_at).getTime());
    if (items.length === 0) continue;
    out.push({ dept, items, total: items.length, done: items.filter((s) => s.status === 'done').length });
  }
  return out;
}

export interface DeptTaskTableProps {
  slots: ScheduleSlot[];
  dayOffset: number;
  /** 这台机还没有排程数据（后端未接，或没给它排） */
  noSchedule?: boolean;
  quotas?: { dept: string; used: number; cap: number; unit: string }[];
}

export default function DeptTaskTable({ slots, dayOffset, noSchedule = false, quotas = [] }: DeptTaskTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = slotsOfDay(slots, dayOffset);
  const groups = groupByDept(slots, dayOffset);
  const done = today.filter((s) => s.status === 'done').length;
  const left = backlogCount(today);
  const bad = today.filter((s) => s.status === 'failed').length;
  const dayEnd = dayRange(dayOffset).end;

  // 主理人要的「还能往哪加」：空档单独成行，表头给当天合计
  const gaps = findGaps(slots, dayOffset);
  const fitByTime = gaps.reduce((n, g) => n + g.canFit, 0);
  const room = headroomText(fitByTime, quotas as never);
  const openGaps = gaps.filter((g) => !g.past);
  const openMinutes = openGaps.reduce((n, g) => n + g.usableMinutes, 0);
  /** 空档的结束时刻正好是下一件活的开始，所以按开始时刻就能把它挂到那件活前面 */
  const gapBefore = (startMs: number): Gap | undefined => gaps.find((g) => g.end === startMs);
  /** 最后一件活跑完到 24:00 的那段，挂在表尾 */
  const tailGap = gaps.length > 0 && gaps[gaps.length - 1].endText === '24:00' ? gaps[gaps.length - 1] : undefined;

  const gapRow = (g: Gap, key: string) => (
    <tr key={key} data-testid="gap-row" data-past={g.past ? '1' : '0'} data-start={g.start} className="align-top">
      <td className={`whitespace-nowrap border-b border-dashed px-4 py-1.5 text-xs tabular-nums ${g.past ? 'text-gray-300' : 'text-blue-600'}`}>
        {g.startText}–{g.endText}
      </td>
      <td colSpan={3} className={`border-b border-dashed px-2 py-1.5 text-xs ${g.past ? 'text-gray-300' : 'text-blue-600'}`}>
        {g.past ? (
          <>空 {gapText(g.minutes)} · 已过</>
        ) : (
          <>
            空 {gapText(g.usableMinutes)} · 还能插 <b>{g.canFit}</b> 单
          </>
        )}
      </td>
    </tr>
  );

  return (
    <section data-testid="dept-task-table" className="flex min-w-0 flex-1 flex-col rounded-xl border bg-white">
      <div
        data-testid="table-head"
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
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            共 <b className="text-gray-800">{today.length}</b> 件 · 已完成 <b className="text-emerald-700">{done}</b> ·
            待跑 <b className="text-gray-800">{left}</b>
            {bad > 0 && (
              <>
                {' '}
                · 失败 <b className="text-red-600">{bad}</b>
              </>
            )}
          </span>
          {openGaps.length === 0 ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">排满了，没空档</span>
          ) : (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 ring-1 ring-blue-200">
              空档 <b>{openGaps.length}</b> 处 · 合计 {gapText(openMinutes)} · 还能加{' '}
              <b>{room.canAdd}</b> 单
              <span className="ml-1 text-blue-500/70">（卡在{room.limitedBy}）</span>
            </span>
          )}
        </span>
      </div>

      {/* 主理人反复强调：页面高度是定的，滑杆在表格里 */}
      <div className="flex min-h-0 flex-1 gap-3 p-3 pt-0">
      <div ref={scrollRef} data-testid="table-scroll" className="h-[620px] flex-1 overflow-y-auto" style={{ maxHeight: VIEW_H }}>
        {noSchedule || groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {noSchedule ? '这台机还没有排程' : '这天没有安排'}
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead data-testid="col-head" className="sticky top-0 z-20 bg-white">
              <tr className="text-left text-xs text-gray-500">
                <th className="w-[150px] border-b bg-white px-4 py-2 font-medium">时间</th>
                <th className="border-b bg-white px-2 py-2 font-medium">任务</th>
                <th className="w-[84px] border-b bg-white px-2 py-2 font-medium">状态</th>
                <th className="w-[38%] border-b bg-white px-2 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const tone = DEPT_BLOCK[g.dept];
                return [
                  <tr key={`h-${g.dept}`} data-testid="dept-head" className="sticky top-[33px] z-10">
                    <td colSpan={4} className={`border-b border-t px-4 py-1.5 text-xs ${tone.bg} ${tone.text}`}>
                      <span className="font-medium">{g.dept}</span>
                      <span className="ml-2 opacity-75">
                        {g.total} 件 · 已完成 {g.done}
                      </span>
                    </td>
                  </tr>,
                  ...g.items.flatMap((s) => {
                    const sp = span(s);
                    const lead = gapBefore(sp.start);
                    const par = parallelWith(s, today);
                    const st = STATUS_STYLE[s.status];
                    const err = s.status === 'failed' ? explainError('executor_lost') : null;
                    const crossesDay = sp.end > dayEnd;
                    return [
                      ...(lead ? [gapRow(lead, `gap-${s.id}`)] : []),
                      <tr key={s.id} data-testid="task-row" data-status={s.status} className="align-top">
                        <td className="whitespace-nowrap border-b px-4 py-2 tabular-nums text-gray-700">
                          {hhmm(sp.start)}–{crossesDay ? `次日 ${hhmm(sp.end)}` : hhmm(sp.end)}
                          <div className="text-[11px] text-gray-400">{durationText(s.est_minutes)}</div>
                        </td>
                        <td className="border-b px-2 py-2">
                          <span className={s.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}>
                            {s.title}
                          </span>
                          {s.source === 'oneoff' && (
                            <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[11px] text-gray-500">单据</span>
                          )}
                          {par.length > 0 && (
                            <span
                              data-testid="parallel-badge"
                              title={`与 ${par.map((p) => p.title).join('、')} 同时进行`}
                              className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[11px] text-indigo-700 ring-1 ring-indigo-200"
                            >
                              并行 {par.length}
                            </span>
                          )}
                        </td>
                        <td className="border-b px-2 py-2">
                          <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${st.cls}`}>
                            {st.label}
                          </span>
                        </td>
                        <td className="border-b px-2 py-2 text-xs text-gray-500">
                          {s.status === 'blocked' && (s.blocked_reason || '前置条件没满足')}
                          {err && `${err.label}：${err.hint}`}
                          {par.length > 0 && s.status !== 'blocked' && s.status !== 'failed' && (
                            <span className="text-gray-400">同时在跑：{par.map((p) => p.title).join('、')}</span>
                          )}
                        </td>
                      </tr>,
                    ];
                  }),
                ];
              })}
              {tailGap && gapRow(tailGap, 'gap-tail')}
            </tbody>
          </table>
        )}
      </div>

      {/* 主理人：「右边能看出这几个地方是空的、空的、空的」——涂色是占住的，留白是空的 */}
      <OccupancyBar
        slots={slots}
        dayOffset={dayOffset}
        onPickGap={(ms) => {
          const el = scrollRef.current;
          if (!el) return;
          const row = el.querySelector(`[data-start="${ms}"]`) as HTMLElement | null;
          if (row) el.scrollTop = Math.max(0, row.offsetTop - 60);
        }}
      />
      </div>
    </section>
  );
}
