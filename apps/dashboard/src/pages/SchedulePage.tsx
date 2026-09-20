/**
 * 设备排程看板（/dashboard/schedule，Brain task f9ab4ab5）
 *
 * 回答主理人的三个问题：这台机器未来几天排了什么？积压多少？今天还能不能加量？
 * 按部门（业务线）分组；数据源见 api/schedule.api.ts（当前为 mock，后端契约已定）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Monitor, AlertTriangle } from 'lucide-react';
import {
  fetchSchedule,
  slotsOfDay,
  backlogCount,
  headroom,
  DEPTS,
  type Dept,
  type DeptQuota,
  type ScheduleDevice,
  type ScheduleSlot,
  type SchedulePayload,
} from '../api/schedule.api';

const DAYS = [
  { offset: 0, label: '今天' },
  { offset: 1, label: '明天' },
  { offset: 2, label: '后天' },
];

const DEPT_TONE: Record<Dept, { dot: string; chip: string }> = {
  智能获客: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  新媒体部: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  私域客服: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 ring-violet-200' },
  视频剪辑: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

const STATUS_TEXT: Record<ScheduleSlot['status'], string> = {
  queued: '待跑',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  blocked: '被挡住',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function QuotaBar({ q }: { q: DeptQuota }) {
  const pct = q.cap > 0 ? Math.min(100, Math.round((q.used / q.cap) * 100)) : 0;
  const left = Math.max(0, q.cap - q.used);
  const tone = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="min-w-[132px]">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-gray-500">{q.dept}</span>
        <span className="tabular-nums text-gray-700">
          {q.used}/{q.cap}
          {q.unit}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-[11px] text-gray-400">
        还能加 {left} {q.unit}
      </div>
    </div>
  );
}

function SlotRow({ s }: { s: ScheduleSlot }) {
  const tone = DEPT_TONE[s.dept];
  const muted = s.status === 'done';
  return (
    <li className="flex items-center gap-2.5 py-1.5 text-sm">
      <span className="w-11 shrink-0 tabular-nums text-xs text-gray-400">{hhmm(s.planned_at)}</span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot} ${muted ? 'opacity-40' : ''}`} />
      <span className={`min-w-0 flex-1 truncate ${muted ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
        {s.title}
      </span>
      {s.source === 'oneoff' && (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">单据</span>
      )}
      {s.status === 'running' && (
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-200">
          进行中
        </span>
      )}
      {s.status === 'failed' && (
        <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 ring-1 ring-red-200">失败</span>
      )}
      {s.status === 'blocked' && (
        <span
          className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-700 ring-1 ring-orange-200"
          title={s.blocked_reason}
        >
          {s.blocked_reason || STATUS_TEXT.blocked}
        </span>
      )}
    </li>
  );
}

/**
 * 一台设备在某个部门分组下的卡片。
 * 跨部门的设备（如悦升机既获客又发布）在每个分组里只显示该部门的活与额度，
 * 否则同一条活会在两个分组里各出现一次，看板就失真了。
 */
function DeviceCard({ d, day, dept }: { d: ScheduleDevice; day: number; dept: Dept }) {
  const todaySlots = slotsOfDay(d.slots, day).filter((s) => s.dept === dept);
  const quotas = d.quotas.filter((q) => q.dept === dept);
  const backlog = backlogCount(todaySlots);
  const room = headroom(quotas);
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            <Link to={`/dashboard/workers/${d.agent_id}`} className="font-medium text-gray-900 hover:underline">
              {d.name}
            </Link>
            <span className="text-xs text-gray-400">{d.serial}</span>
          </div>
          {d.depts.length > 1 && (
            <div className="mt-1 text-[11px] text-gray-400">另兼 {d.depts.filter((x) => x !== dept).join('、')}</div>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          {quotas.map((q) => (
            <QuotaBar key={q.dept} q={q} />
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 border-t pt-2 text-xs text-gray-500">
        <span>
          {DAYS.find((x) => x.offset === day)?.label}共 <b className="text-gray-800">{todaySlots.length}</b> 件
        </span>
        <span>
          待跑 <b className={backlog > 0 ? 'text-amber-700' : 'text-gray-800'}>{backlog}</b>
        </span>
        <span className="ml-auto">
          还可加量 <b className={room > 0 ? 'text-emerald-700' : 'text-red-600'}>{room}</b>
        </span>
      </div>

      {todaySlots.length === 0 ? (
        <div className="py-3 text-sm text-gray-400">这天没有安排</div>
      ) : (
        <ul className="divide-y">
          {todaySlots.map((s) => (
            <SlotRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SchedulePage() {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [day, setDay] = useState(0);
  const [dept, setDept] = useState<Dept | '全部'>('全部');

  useEffect(() => {
    let alive = true;
    fetchSchedule().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!data) return [];
    const list = dept === '全部' ? DEPTS : [dept];
    return list
      .map((x) => ({ dept: x, devices: data.devices.filter((d) => d.depts.includes(x)) }))
      .filter((g) => g.devices.length > 0);
  }, [data, dept]);

  const totals = useMemo(() => {
    if (!data) return { backlog: 0, room: 0, blocked: 0 };
    let backlog = 0;
    let room = 0;
    let blocked = 0;
    for (const d of data.devices) {
      const ss = slotsOfDay(d.slots, day);
      backlog += backlogCount(ss);
      blocked += ss.filter((s) => s.status === 'blocked' || s.status === 'failed').length;
      room += headroom(d.quotas);
    }
    return { backlog, room, blocked };
  }, [data, day]);

  if (!data) return <div className="p-6 text-sm text-gray-500">加载中…</div>;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Monitor className="h-5 w-5 text-gray-400" />
          排程
        </h1>
        {data.mock && (
          <span className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
            <AlertTriangle className="h-3 w-3" />
            样例数据，后端接入前仅供看形
          </span>
        )}
        <Link to="/dashboard/workers" className="ml-auto text-sm text-blue-600 hover:underline">
          看实时画面 →
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border">
          {DAYS.map((d) => (
            <button
              key={d.offset}
              onClick={() => setDay(d.offset)}
              className={`px-3 py-1.5 text-sm ${day === d.offset ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['全部', ...DEPTS] as const).map((x) => (
            <button
              key={x}
              onClick={() => setDept(x)}
              className={`rounded-full px-3 py-1 text-xs ring-1 ${
                dept === x ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-4 text-sm">
          <span className="text-gray-500">
            待跑 <b className="text-gray-900">{totals.backlog}</b>
          </span>
          <span className="text-gray-500">
            要处理 <b className={totals.blocked > 0 ? 'text-red-600' : 'text-gray-900'}>{totals.blocked}</b>
          </span>
          <span className="text-gray-500">
            还可加量 <b className="text-emerald-700">{totals.room}</b>
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {grouped.map((g) => (
          <section key={g.dept}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${DEPT_TONE[g.dept].dot}`} />
              <h2 className="font-medium text-gray-900">{g.dept}</h2>
              <span className="text-xs text-gray-400">{g.devices.length} 台设备</span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {g.devices.map((d) => (
                <DeviceCard key={`${g.dept}-${d.agent_id}`} d={d} day={day} dept={g.dept} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
