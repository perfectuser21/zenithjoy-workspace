/**
 * 工作机控制塔 · 总览（/dashboard/workers）
 *
 * 主理人 0920：
 *   「应该在工作机页面里直接有个 calendar，每一天、一周我都能看得到，
 *     而不是再弄个新的页面。」→ 排程内嵌，不做独立排程页
 *   「我不是要甘特图，我要 table 那种效果，而且应该是一个机子一个 table，
 *     告诉我今天每一天的工作是哪些；有的时候它可能是并行好几个工作，你应该这样排出来。」
 *     → 一台设备一张 DeviceTaskTable，本页只负责选日期、筛部门、出总计
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchWorkers, type Worker } from '../api/workers.api';
import {
  fetchSchedule,
  slotsOfDay,
  backlogCount,
  DEPTS,
  type Dept,
  type ScheduleDevice,
} from '../api/schedule.api';
import DeviceTaskTable from '../components/DeviceTaskTable';
import { DEPT_BLOCK } from '../components/dept-colors';

const POLL_MS = 5000;

function dayLabel(offset: number): string {
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === -1) return '昨天';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sched, setSched] = useState<ScheduleDevice[]>([]);
  const [mock, setMock] = useState(false);
  const [offset, setOffset] = useState(0);
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
      .map((w) => ({ w, d: sched.find((s) => s.agent_id === w.id) }))
      .filter((r) => dept === '全部' || r.d?.depts.includes(dept))
      .map(({ w, d }) => ({
        key: w.id,
        device: d,
        name: d?.name || w.nickname || w.hostname,
        serial: d?.serial,
        online: w.status === 'online',
        runningText: w.running
          ? `正在跑：${w.running.title}（第 ${w.running.current_step}/${w.running.steps_total} 步）`
          : undefined,
        href: `/dashboard/workers/${w.id}`,
      }));
  }, [workers, sched, dept]);

  const totals = useMemo(() => {
    let planned = 0;
    let done = 0;
    let left = 0;
    let bad = 0;
    for (const r of rows) {
      if (!r.device) continue;
      const ss = slotsOfDay(r.device.slots, offset);
      planned += ss.length;
      done += ss.filter((s) => s.status === 'done').length;
      left += backlogCount(ss);
      bad += ss.filter((s) => s.status === 'failed').length;
    }
    return { planned, done, left, bad };
  }, [rows, offset]);

  if (error && !workers)
    return (
      <div className="p-6">
        <div className="rounded-2xl bg-white p-5 text-red-600 shadow-sm">加载失败：{error}</div>
      </div>
    );
  if (!workers)
    return (
      <div className="p-6">
        <div className="rounded-2xl bg-white p-5 text-gray-500 shadow-sm">加载中…</div>
      </div>
    );

  if (workers.length === 0) {
    return (
      <div className="p-6">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">工作机</h1>
          <p className="text-gray-600">还没有工作机。安装 Agent 并用你的 license 注册后，它会出现在这里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">工作机</h1>
        {mock && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">
            排期为样例数据，后端接入前仅供看形
          </span>
        )}
        <div className="ml-auto flex gap-4 text-sm">
          <span className="text-gray-500">
            共 <b className="text-gray-900">{totals.planned}</b> 件
          </span>
          <span className="text-gray-500">
            已完成 <b className="text-emerald-700">{totals.done}</b>
          </span>
          <span className="text-gray-500">
            待跑 <b className="text-gray-900">{totals.left}</b>
          </span>
          {totals.bad > 0 && (
            <span className="text-gray-500">
              失败 <b className="text-red-600">{totals.bad}</b>
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center overflow-hidden rounded-lg border bg-white">
          <button aria-label="前一天" onClick={() => setOffset((o) => o - 1)} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setOffset(0)} className="min-w-[126px] px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
            {dayLabel(offset)}
          </button>
          <button aria-label="后一天" onClick={() => setOffset((o) => o + 1)} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronRight className="h-4 w-4" />
          </button>
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

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          {DEPTS.map((d) => (
            <span key={d} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-sm ${DEPT_BLOCK[d].bar}`} />
              {d}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-xl border py-10 text-center text-sm text-gray-400">没有匹配的设备</div>
        ) : (
          rows.map((r) => (
            <DeviceTaskTable
              key={r.key}
              name={r.name}
              serial={r.serial}
              online={r.online}
              href={r.href}
              runningText={r.runningText}
              quotas={r.device?.quotas}
              slots={r.device?.slots ?? []}
              dayOffset={offset}
              noSchedule={!r.device}
            />
          ))
        )}
      </div>
      </div>
    </div>
  );
}
