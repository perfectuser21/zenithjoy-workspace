/**
 * 工作机控制塔 · 总览（/dashboard/workers）
 *
 * 主理人 0920：
 *   「应该在工作机页面里直接有个 calendar，24 小时 timeline，每一天、一周我都能看得到，
 *     而不是再弄个新的页面。」→ 排程内嵌，不做独立排程页
 *   「上面的表和底下的表应该是一个嘛，你现在弄成两个；高度和长度应该不变，应该有个可以滑的进度条。」
 *     → 所有设备在同一张甘特表里，左列与表头固定，横向滑看细节
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
import ScheduleGantt, { type GanttRow } from '../components/ScheduleGantt';
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

function dateText(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

  const rows: GanttRow[] = useMemo(() => {
    if (!workers) return [];
    const days = week ? Array.from({ length: 7 }, (_, i) => offset + i) : [offset];
    return workers
      .map((w) => ({ w, d: sched.find((s) => s.agent_id === w.id) }))
      .filter((r) => dept === '全部' || r.d?.depts.includes(dept))
      .map(({ w, d }) => ({
        key: w.id,
        device: d,
        name: w.nickname || w.hostname,
        online: w.status === 'online',
        runningText: w.running
          ? `正在跑：${w.running.title}（第 ${w.running.current_step}/${w.running.steps_total} 步）`
          : undefined,
        href: `/dashboard/workers/${w.id}`,
        days,
      }));
  }, [workers, sched, dept, week, offset]);

  const totals = useMemo(() => {
    let planned = 0;
    let done = 0;
    let left = 0;
    let bad = 0;
    for (const r of rows) {
      if (!r.device) continue;
      for (const d of r.days) {
        const ss = slotsOfDay(r.device.slots, d);
        planned += ss.length;
        done += ss.filter((s) => s.status === 'done').length;
        left += backlogCount(ss);
        bad += ss.filter((s) => s.status === 'failed').length;
      }
    }
    return { planned, done, left, bad };
  }, [rows]);

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
          <button aria-label="前一天" onClick={() => setOffset((o) => o - (week ? 7 : 1))} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setOffset(0)} className="min-w-[126px] px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
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

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          {DEPTS.map((d) => (
            <span key={d} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-sm ${DEPT_BLOCK[d].bar}`} />
              {d}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <ScheduleGantt rows={rows} week={week} />
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">
        表内可左右拖动看全天；设备名与时间刻度固定不动。点设备名进实时画面。
      </p>
      </div>
    </div>
  );
}
