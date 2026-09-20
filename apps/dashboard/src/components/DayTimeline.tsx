/**
 * 24 小时时间轴（Brain task 89f2f866）
 *
 * 主理人：「应该在工作机页面里直接有个 calendar，24 小时 timeline，
 * 每一天、一周我都能看得到，里面啥是啥直接写出来。」
 *
 * 一条轴 = 一台设备的一天。色块按部门着色，块够宽就把任务名写进去，
 * 当前时刻画一条红线。周视图把 7 条轴叠起来即可，不另做组件。
 */
import type { Dept, ScheduleSlot } from '../api/schedule.api';

export const DEPT_BLOCK: Record<Dept, { bg: string; bar: string; text: string }> = {
  智能获客: { bg: 'bg-emerald-100', bar: 'bg-emerald-500', text: 'text-emerald-900' },
  新媒体部: { bg: 'bg-sky-100', bar: 'bg-sky-500', text: 'text-sky-900' },
  私域客服: { bg: 'bg-violet-100', bar: 'bg-violet-500', text: 'text-violet-900' },
  视频剪辑: { bg: 'bg-amber-100', bar: 'bg-amber-500', text: 'text-amber-900' },
};

const DAY_MS = 24 * 3600_000;

/** 色块在轴上的位置：左边距与宽度都是整天的百分比 */
export function blockGeometry(slot: ScheduleSlot, dayStart: number): { left: number; width: number } {
  const start = new Date(slot.planned_at).getTime();
  const rawLeft = ((start - dayStart) / DAY_MS) * 100;
  const rawWidth = ((slot.est_minutes * 60_000) / DAY_MS) * 100;
  const left = Math.max(0, Math.min(100, rawLeft));
  // 跨到次日的部分截断在 24 点；再窄也留 0.8% 以免点不到
  const width = Math.max(0.8, Math.min(100 - left, rawWidth));
  return { left, width };
}

/** 当前时刻在这条轴上的百分比；不在今天返回 null（不画红线） */
export function nowMarker(dayStart: number, now = Date.now()): number | null {
  if (now < dayStart || now >= dayStart + DAY_MS) return null;
  return ((now - dayStart) / DAY_MS) * 100;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function blockTitle(s: ScheduleSlot): string {
  const st =
    s.status === 'done' ? '已完成' : s.status === 'running' ? '进行中' : s.status === 'failed' ? '失败' : s.status === 'blocked' ? `被挡住：${s.blocked_reason ?? ''}` : '待跑';
  return `${hhmm(s.planned_at)} ${s.title}\n${s.dept} · ${st} · 约 ${s.est_minutes} 分钟`;
}

export interface DayTimelineProps {
  slots: ScheduleSlot[];
  dayStart: number;
  /** 轴高度，周视图用矮的 */
  compact?: boolean;
  /** 点一个色块 */
  onPick?: (s: ScheduleSlot) => void;
}

export default function DayTimeline({ slots, dayStart, compact = false, onPick }: DayTimelineProps) {
  const marker = nowMarker(dayStart);
  const h = compact ? 'h-7' : 'h-11';
  return (
    <div data-testid="day-timeline" className={`relative w-full ${h} rounded-md bg-gray-50 ring-1 ring-gray-200`}>
      {/* 每 3 小时一根刻度 */}
      {[3, 6, 9, 12, 15, 18, 21].map((hour) => (
        <div key={hour} aria-hidden className="absolute top-0 bottom-0 w-px bg-gray-200" style={{ left: `${(hour / 24) * 100}%` }} />
      ))}

      {slots.map((s) => {
        const g = blockGeometry(s, dayStart);
        const tone = DEPT_BLOCK[s.dept];
        const done = s.status === 'done';
        const bad = s.status === 'failed';
        const blocked = s.status === 'blocked';
        return (
          <button
            key={s.id}
            type="button"
            data-testid="timeline-block"
            data-status={s.status}
            title={blockTitle(s)}
            onClick={() => onPick?.(s)}
            className={`absolute top-[3px] bottom-[3px] overflow-hidden rounded px-1 text-left text-[11px] leading-tight ring-1 ${
              bad
                ? 'bg-red-100 text-red-900 ring-red-300'
                : blocked
                  ? 'bg-orange-100 text-orange-900 ring-orange-300'
                  : `${tone.bg} ${tone.text} ring-black/5`
            } ${done ? 'opacity-50' : ''} ${s.status === 'running' ? 'ring-2 ring-amber-400' : ''}`}
            style={{ left: `${g.left}%`, width: `${g.width}%` }}
          >
            {!compact && g.width > 7 && <span className="block truncate">{s.title}</span>}
            {!compact && g.width > 14 && <span className="block truncate opacity-70">{hhmm(s.planned_at)}</span>}
          </button>
        );
      })}

      {marker !== null && (
        <div data-testid="now-marker" aria-hidden className="pointer-events-none absolute -top-0.5 -bottom-0.5 w-0.5 bg-red-500" style={{ left: `${marker}%` }}>
          <span className="absolute -top-1 -left-[3px] h-2 w-2 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  );
}

/** 轴下方的小时刻度尺，一屏共用一条即可 */
export function HourRuler({ compact = false }: { compact?: boolean }) {
  const hours = compact ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21];
  return (
    <div data-testid="hour-ruler" className="relative mt-0.5 h-3 w-full text-[10px] text-gray-400">
      {hours.map((h) => (
        <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(h / 24) * 100}%` }}>
          {h === 0 ? '0点' : h}
        </span>
      ))}
      <span className="absolute right-0 tabular-nums">24</span>
    </div>
  );
}
