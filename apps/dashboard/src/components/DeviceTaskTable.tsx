/**
 * 单台设备的当日任务表（Brain task 02c33c83）
 *
 * 主理人：「我不是要甘特图，我要 table 那种效果，而且应该是一个机子一个 table，
 * 告诉我今天每一天的工作是哪些；有的时候它可能是并行好几个工作，你应该这样排出来。」
 *
 * 所以：一台机一张表，按开始时间排；时间区间重叠的活标「并行」，点开能看到跟谁并行。
 */
import { Link } from 'react-router-dom';
import { backlogCount, slotsOfDay, type ScheduleSlot } from '../api/schedule.api';
import { DEPT_BLOCK } from './dept-colors';
import { explainError } from '../api/error-codes';

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
export function span(s: ScheduleSlot): { start: number; end: number } {
  const start = new Date(s.planned_at).getTime();
  return { start, end: start + s.est_minutes * 60_000 };
}

/** 跟它同时在跑的其它活（时间区间有重叠即算并行） */
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

export interface DeviceTaskTableProps {
  name: string;
  serial?: string;
  online: boolean;
  href: string;
  runningText?: string;
  quotas?: { dept: string; used: number; cap: number; unit: string }[];
  slots: ScheduleSlot[];
  /** 相对今天的偏移，用于切出当天的活 */
  dayOffset: number;
  /** 没有排程数据（后端未接或这台机没排） */
  noSchedule?: boolean;
}

export default function DeviceTaskTable({
  name,
  serial,
  online,
  href,
  runningText,
  quotas = [],
  slots,
  dayOffset,
  noSchedule = false,
}: DeviceTaskTableProps) {
  const today = slotsOfDay(slots, dayOffset);
  const done = today.filter((s) => s.status === 'done').length;
  const left = backlogCount(today);
  const bad = today.filter((s) => s.status === 'failed').length;

  return (
    <section data-testid="device-task-table" className="rounded-xl border bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        <Link to={href} className="font-medium text-gray-900 hover:underline">
          {name}
        </Link>
        {serial && <span className="text-xs text-gray-400">{serial}</span>}
        {runningText ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">{runningText}</span>
        ) : (
          <span className="text-xs text-gray-400">空闲</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          {quotas.map((q) => (
            <span key={q.dept}>
              {q.dept} <b className="text-gray-800">{q.used}/{q.cap}{q.unit}</b>
              <span className="ml-1 text-gray-400">还能加 {Math.max(0, q.cap - q.used)}</span>
            </span>
          ))}
          <span>
            共 <b className="text-gray-800">{today.length}</b> 件 · 已完成{' '}
            <b className="text-emerald-700">{done}</b> · 待跑 <b className="text-gray-800">{left}</b>
            {bad > 0 && (
              <>
                {' '}
                · 失败 <b className="text-red-600">{bad}</b>
              </>
            )}
          </span>
          <Link to={href} className="text-blue-600 hover:underline">
            实时画面 →
          </Link>
        </div>
      </div>

      {noSchedule ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">这台机还没有排程</div>
      ) : today.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">这天没有安排</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="w-[132px] px-4 py-2 font-medium">时间</th>
              <th className="px-2 py-2 font-medium">任务</th>
              <th className="w-[96px] px-2 py-2 font-medium">部门</th>
              <th className="w-[84px] px-2 py-2 font-medium">状态</th>
              <th className="px-2 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {today.map((s) => {
              const sp = span(s);
              const par = parallelWith(s, today);
              const st = STATUS_STYLE[s.status];
              const tone = DEPT_BLOCK[s.dept];
              const err = s.status === 'failed' ? explainError('executor_lost') : null;
              return (
                <tr key={s.id} data-testid="task-row" data-status={s.status} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-gray-700">
                    {hhmm(sp.start)}–{hhmm(sp.end)}
                    <div className="text-[11px] text-gray-400">{durationText(s.est_minutes)}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className={s.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}>{s.title}</span>
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
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone.bg} ${tone.text}`}>{s.dept}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-2 py-2 text-xs text-gray-500">
                    {s.status === 'blocked' && (s.blocked_reason || '前置条件没满足')}
                    {s.status === 'failed' && (err ? `${err.label}：${err.hint}` : '失败')}
                    {par.length > 0 && s.status !== 'blocked' && s.status !== 'failed' && (
                      <span className="text-gray-400">同时在跑：{par.map((p) => p.title).join('、')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
