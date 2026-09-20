/**
 * 设备排程甘特表（Brain task 42d9e1f8）
 *
 * 主理人：「上面的表和底下的表应该是一个嘛，你现在弄成两个；里面的高度和长度应该不变，
 * 应该有个可以滑的进度条。」
 *
 * 所以不再是「一台设备一张卡各画各的」，而是一张表：
 *   左列设备名固定（横滑时不动）· 表头 24 小时刻度固定（纵滚时不动）
 *   外框高度固定，设备多了纵向滚动；时间轴按小时给足宽度，横向滚动看细节
 * 日视图一台一行；周视图同一张表里把每台展开成 7 个子行。
 */
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { dayRange, slotsOfDay, backlogCount, type ScheduleDevice, type ScheduleSlot } from '../api/schedule.api';
import { DEPT_BLOCK } from './dept-colors';

/** 每小时占多少像素。给足宽度才能看清窄块，放不下就横向滚动 */
export const HOUR_PX = 74;
export const DAY_PX = HOUR_PX * 24;
const NAME_COL = 208;
const ROW_H = 40;
const SUB_ROW_H = 26;

const DAY_MS = 24 * 3600_000;

export interface GanttRow {
  key: string;
  device: ScheduleDevice | undefined;
  name: string;
  online: boolean;
  runningText?: string;
  href: string;
  /** 日视图 = [offset]；周视图 = 7 天 */
  days: number[];
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusText(s: ScheduleSlot): string {
  if (s.status === 'done') return '已完成';
  if (s.status === 'running') return '进行中';
  if (s.status === 'failed') return '失败';
  if (s.status === 'blocked') return `被挡住：${s.blocked_reason ?? ''}`;
  return '待跑';
}

/** 色块几何：以像素算，跨日截断在当天末尾 */
export function blockPx(slot: ScheduleSlot, dayStart: number): { left: number; width: number } {
  const start = new Date(slot.planned_at).getTime();
  const left = Math.max(0, Math.min(DAY_PX, ((start - dayStart) / DAY_MS) * DAY_PX));
  const raw = ((slot.est_minutes * 60_000) / DAY_MS) * DAY_PX;
  return { left, width: Math.max(6, Math.min(DAY_PX - left, raw)) };
}

/** 当前时刻的像素位置；不在这天返回 null */
export function nowPx(dayStart: number, now = Date.now()): number | null {
  if (now < dayStart || now >= dayStart + DAY_MS) return null;
  return ((now - dayStart) / DAY_MS) * DAY_PX;
}

function dayShort(offset: number): string {
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === -1) return '昨天';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()} 周${'日一二三四五六'[d.getDay()]}`;
}

function TrackRow({
  slots,
  dayStart,
  height,
  label,
  showText,
}: {
  slots: ScheduleSlot[];
  dayStart: number;
  height: number;
  label?: string;
  showText: boolean;
}) {
  const marker = nowPx(dayStart);
  return (
    <div data-testid="gantt-track" className="relative border-b border-gray-100" style={{ width: DAY_PX, height }}>
      {Array.from({ length: 24 }, (_, h) => (
        <div
          key={h}
          aria-hidden
          className={`absolute top-0 bottom-0 w-px ${h % 6 === 0 ? 'bg-gray-200' : 'bg-gray-100'}`}
          style={{ left: h * HOUR_PX }}
        />
      ))}
      {label && (
        <span className="pointer-events-none absolute left-1 top-0.5 z-10 rounded bg-white/70 px-1 text-[10px] text-gray-400">
          {label}
        </span>
      )}
      {slots.map((s) => {
        const g = blockPx(s, dayStart);
        const tone = DEPT_BLOCK[s.dept];
        return (
          <div
            key={s.id}
            data-testid="gantt-block"
            data-status={s.status}
            title={`${hhmm(s.planned_at)} ${s.title}\n${s.dept} · ${statusText(s)} · 约 ${s.est_minutes} 分钟`}
            className={`absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-tight ring-1 ${
              s.status === 'failed'
                ? 'bg-red-100 text-red-900 ring-red-300'
                : s.status === 'blocked'
                  ? 'bg-orange-100 text-orange-900 ring-orange-300'
                  : `${tone.bg} ${tone.text} ring-black/5`
            } ${s.status === 'done' ? 'opacity-45' : ''} ${s.status === 'running' ? 'ring-2 ring-amber-400' : ''}`}
            style={{ left: g.left, width: g.width }}
          >
            {showText && g.width > 54 && (
              <>
                <span className="block truncate font-medium">{s.title}</span>
                <span className="block truncate opacity-70">{hhmm(s.planned_at)}</span>
              </>
            )}
          </div>
        );
      })}
      {marker !== null && (
        <div data-testid="gantt-now" aria-hidden className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-red-500" style={{ left: marker }} />
      )}
    </div>
  );
}

export default function ScheduleGantt({ rows, week, height = 460 }: { rows: GanttRow[]; week: boolean; height?: number }) {
  const scroller = useRef<HTMLDivElement>(null);

  // 打开时把视野落在当前时刻附近，而不是停在 0 点
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = nowPx(dayRange(0).start);
    el.scrollLeft = x === null ? 0 : Math.max(0, x - el.clientWidth / 2);
  }, [week]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  return (
    <div data-testid="schedule-gantt" className="overflow-hidden rounded-xl border bg-white">
      <div ref={scroller} className="overflow-auto" style={{ height }}>
        <div className="relative" style={{ width: NAME_COL + DAY_PX }}>
          {/* 表头：纵滚不动 */}
          <div className="sticky top-0 z-30 flex bg-white/95 backdrop-blur">
            <div className="sticky left-0 z-40 shrink-0 border-b border-r bg-white/95 px-3 py-2 text-xs font-medium text-gray-500" style={{ width: NAME_COL }}>
              设备
            </div>
            <div className="relative border-b" style={{ width: DAY_PX, height: 34 }}>
              {hours.map((h) => (
                <span
                  key={h}
                  className={`absolute top-2 -translate-x-1/2 text-[11px] tabular-nums ${h % 6 === 0 ? 'font-medium text-gray-600' : 'text-gray-400'}`}
                  style={{ left: h * HOUR_PX }}
                >
                  {h === 0 ? '0点' : h}
                </span>
              ))}
              <span className="absolute right-0 top-2 text-[11px] tabular-nums text-gray-400">24</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-400">没有匹配的设备</div>
          ) : (
            rows.map((r) => (
              <div key={r.key} data-testid="gantt-row" className="flex">
                {/* 设备列：横滑不动 */}
                <div
                  className="sticky left-0 z-20 shrink-0 border-b border-r bg-white px-3 py-1.5"
                  style={{ width: NAME_COL }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    <Link to={r.href} className="truncate text-sm font-medium text-gray-900 hover:underline">
                      {r.name}
                    </Link>
                  </div>
                  {r.runningText ? (
                    <div className="truncate text-[11px] text-amber-700" title={r.runningText}>
                      {r.runningText}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-400">空闲</div>
                  )}
                  {r.device && (
                    <div className="mt-0.5 truncate text-[11px] text-gray-500">
                      {r.device.quotas.map((q) => `${q.used}/${q.cap}${q.unit}`).join(' · ')}
                      {(() => {
                        const today = slotsOfDay(r.device!.slots, r.days[0]);
                        const left = backlogCount(today);
                        return left > 0 ? <span className="ml-1 text-gray-400">待跑 {left}</span> : null;
                      })()}
                    </div>
                  )}
                </div>

                <div>
                  {r.days.map((d) => (
                    <TrackRow
                      key={d}
                      slots={r.device ? slotsOfDay(r.device.slots, d) : []}
                      dayStart={dayRange(d).start}
                      height={week ? SUB_ROW_H : ROW_H + 18}
                      label={week ? dayShort(d) : undefined}
                      showText={!week}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
