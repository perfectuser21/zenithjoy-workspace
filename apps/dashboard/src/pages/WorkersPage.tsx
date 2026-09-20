/**
 * 工作机控制塔 · 总览（/dashboard/workers）
 *
 * 主理人 0920：「我控制了这么多电脑……应该在工作机页面里直接有个 calendar，
 * 24 小时 timeline，每一天、一周我都能看得到，而不是再弄个新的页面。」
 * 所以排程不再是独立页面：每台设备一条 24 小时时间轴，支持前后翻天与整周视图。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchWorkers, type Worker } from '../api/workers.api';
import {
  fetchSchedule,
  slotsOfDay,
  dayRange,
  backlogCount,
  DEPTS,
  type Dept,
  type ScheduleDevice,
  type ScheduleSlot,
} from '../api/schedule.api';
import DayTimeline, { HourRuler, DEPT_BLOCK } from '../components/DayTimeline';

const POLL_MS = 5000;

function osBadge(os: Worker['os_type']) {
  if (os === 'android') return '📱 安卓';
  if (os === 'win32') return '🖥️ Windows';
  return `💻 ${os ?? '未知'}`;
}

function dayLabel(offset: number): string {
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === -1) return '昨天';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
}

function dateText(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 一台设备某天的任务量统计，供行内小字显示 */
function dayStat(slots: ScheduleSlot[]) {
  return {
    total: slots.length,
    done: slots.filter((s) => s.status === 'done').length,
    left: backlogCount(slots),
    bad: slots.filter((s) => s.status === 'failed').length,
  };
}

function DeviceRow({
  worker,
  sched,
  offset,
  week,
}: {
  worker: Worker;
  sched: ScheduleDevice | undefined;
  offset: number;
  week: boolean;
}) {
  const slots = sched?.slots ?? [];
  const days = week ? [0, 1, 2, 3, 4, 5, 6].map((i) => offset + i) : [offset];

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`h-2 w-2 rounded-full ${worker.status === 'online' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
        <Link to={`/dashboard/workers/${worker.id}`} className="font-medium text-gray-900 hover:underline">
          {worker.nickname || worker.hostname}
        </Link>
        <span className="text-xs text-gray-400">{osBadge(worker.os_type)}</span>
        {sched?.depts.map((d) => (
          <span key={d} className={`rounded px-1.5 py-0.5 text-[11px] ${DEPT_BLOCK[d].bg} ${DEPT_BLOCK[d].text}`}>
            {d}
          </span>
        ))}
        {worker.running ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">
            正在跑：{worker.running.title}（第 {worker.running.current_step}/{worker.running.steps_total} 步）
          </span>
        ) : (
          <span className="text-xs text-gray-400">空闲</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          {sched?.quotas.map((q) => (
            <span key={q.dept} className="text-gray-500">
              {q.dept} <b className="text-gray-800">{q.used}/{q.cap}{q.unit}</b>
              <span className="ml-1 text-gray-400">还能加 {Math.max(0, q.cap - q.used)}</span>
            </span>
          ))}
          <Link to={`/dashboard/workers/${worker.id}`} className="text-blue-600 hover:underline">
            实时画面 →
          </Link>
        </div>
      </div>

      {!sched ? (
        <div className="mt-3 rounded-md bg-gray-50 py-3 text-center text-xs text-gray-400">这台机还没有排程</div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {days.map((d) => {
            const ss = slotsOfDay(slots, d);
            const st = dayStat(ss);
            return (
              <div key={d} className={week ? 'flex items-center gap-2' : ''}>
                {week && (
                  <div className="w-24 shrink-0 text-xs text-gray-500">
                    {dayLabel(d)}
                    <span className="ml-1 text-gray-400">
                      {st.total > 0 ? `${st.done}/${st.total}` : '—'}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <DayTimeline slots={ss} dayStart={dayRange(d).start} compact={week} />
                </div>
              </div>
            );
          })}
          {!week && (
            <>
              <HourRuler />
              <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                {(() => {
                  const st = dayStat(slotsOfDay(slots, offset));
                  return (
                    <>
                      <span>
                        共 <b className="text-gray-800">{st.total}</b> 件
                      </span>
                      <span>
                        已完成 <b className="text-emerald-700">{st.done}</b>
                      </span>
                      <span>
                        待跑 <b className="text-gray-800">{st.left}</b>
                      </span>
                      {st.bad > 0 && (
                        <span>
                          失败 <b className="text-red-600">{st.bad}</b>
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sched, setSched] = useState<ScheduleDevice[]>([]);
  const [mock, setMock] = useState(false);
  const [offset, setOffset] = useState(0);
  const [week, setWeek] = useState(false);
  const [dept, setDept] = useState<Dept | '全部'>('全部');

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchWorkers()
        .then((w) => {
          if (alive) {
            setWorkers(w);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetchSchedule().then((d) => {
      if (!alive) return;
      setSched(d.devices);
      setMock(d.mock);
    });
    return () => {
      alive = false;
    };
  }, []);

  const rows = useMemo(() => {
    if (!workers) return [];
    return workers
      .map((w) => ({ worker: w, sched: sched.find((s) => s.agent_id === w.id) }))
      .filter((r) => dept === '全部' || r.sched?.depts.includes(dept));
  }, [workers, sched, dept]);

  if (error && !workers) return <div className="p-6 text-red-600">加载失败：{error}</div>;
  if (!workers) return <div className="p-6 text-gray-500">加载中…</div>;

  if (workers.length === 0) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-xl font-semibold">工作机</h1>
        <p className="text-gray-600">还没有工作机。安装 Agent 并用你的 license 注册后，它会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">工作机</h1>
        {mock && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
            排期为样例数据，后端接入前仅供看形
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-lg border bg-white">
          <button aria-label="前一天" onClick={() => setOffset((o) => o - (week ? 7 : 1))} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setOffset(0)} className="min-w-[124px] px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
            {week ? `${dateText(offset)} 起 7 天` : dayLabel(offset)}
          </button>
          <button aria-label="后一天" onClick={() => setOffset((o) => o + (week ? 7 : 1))} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex overflow-hidden rounded-lg border">
          {[
            { w: false, label: '日' },
            { w: true, label: '周' },
          ].map((v) => (
            <button
              key={v.label}
              onClick={() => setWeek(v.w)}
              className={`px-3 py-1.5 text-sm ${week === v.w ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {v.label}
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

        {offset !== 0 && (
          <button onClick={() => setOffset(0)} className="text-xs text-blue-600 hover:underline">
            回到今天
          </button>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-xl border bg-white py-8 text-center text-sm text-gray-400">
            该部门下没有设备
          </div>
        ) : (
          rows.map((r) => (
            <DeviceRow key={r.worker.id} worker={r.worker} sched={r.sched} offset={offset} week={week} />
          ))
        )}
      </div>
    </div>
  );
}
