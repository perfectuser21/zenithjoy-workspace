/**
 * 某台手机的「今日全貌」（Brain task 3bbdb025）
 *
 * 主理人原话：「这个手机安排了 50 个任务，今天已执行 25 个，下面还有哪些任务，
 * 我现在看不到，只能看到已完成和失败的。」
 *
 * 实时详情页此前只有「当前任务 + 跑过的」，没有待办队列、没有今日总量。
 * 这里补上：一行进度（排 N / 完成 M / 待跑 K / 要处理 J）+ 按部门分组的待办清单。
 * 数据复用排程契约 schedule.api（一套契约两个视角），后端接入时只改 fetchSchedule 一处。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSchedule, slotsOfDay, type Dept, type ScheduleDevice, type ScheduleSlot } from '../api/schedule.api';

const DEPT_DOT: Record<Dept, string> = {
  智能获客: 'bg-emerald-500',
  新媒体部: 'bg-sky-500',
  私域客服: 'bg-violet-500',
  视频剪辑: 'bg-amber-500',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export interface DayTally {
  planned: number;
  done: number;
  queued: number;
  attention: number;
}

/** 今日盘点：排了多少、跑完多少、还剩多少、多少件要人管 */
export function tally(slots: ScheduleSlot[]): DayTally {
  return {
    planned: slots.length,
    done: slots.filter((s) => s.status === 'done').length,
    queued: slots.filter((s) => s.status === 'queued').length,
    attention: slots.filter((s) => s.status === 'failed' || s.status === 'blocked').length,
  };
}

/** 待办按部门分组，组内按时刻升序 */
export function groupPending(slots: ScheduleSlot[]): { dept: Dept; items: ScheduleSlot[] }[] {
  const pending = slots.filter((s) => s.status === 'queued' || s.status === 'blocked');
  const map = new Map<Dept, ScheduleSlot[]>();
  for (const s of pending) map.set(s.dept, [...(map.get(s.dept) ?? []), s]);
  return [...map.entries()]
    .map(([dept, items]) => ({ dept, items: items.sort((a, b) => a.planned_at.localeCompare(b.planned_at)) }))
    .sort((a, b) => a.dept.localeCompare(b.dept));
}

function Bar({ t }: { t: DayTally }) {
  const pct = (n: number) => (t.planned > 0 ? (n / t.planned) * 100 : 0);
  return (
    <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="bg-emerald-500" style={{ width: `${pct(t.done)}%` }} title={`已完成 ${t.done}`} />
      <div className="bg-red-400" style={{ width: `${pct(t.attention)}%` }} title={`要处理 ${t.attention}`} />
      <div className="bg-gray-300" style={{ width: `${pct(t.queued)}%` }} title={`待跑 ${t.queued}`} />
    </div>
  );
}

export default function WorkerDayPlan({ agentId }: { agentId: string }) {
  const [device, setDevice] = useState<ScheduleDevice | null>(null);
  const [mock, setMock] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchSchedule().then((d) => {
      if (!alive) return;
      setDevice(d.devices.find((x) => x.agent_id === agentId) ?? null);
      setMock(d.mock);
    });
    return () => {
      alive = false;
    };
  }, [agentId]);

  if (!device) return null;

  const today = slotsOfDay(device.slots, 0);
  const t = tally(today);
  const groups = groupPending(today);

  return (
    <section data-testid="worker-day-plan" className="mt-6 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-gray-700">今日安排</h3>
        {mock && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">样例数据</span>}
        <Link to="/dashboard/workers" className="ml-auto text-xs text-blue-600 hover:underline">
          看全部设备时间轴 →
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="text-gray-500">
          共排 <b className="text-gray-900">{t.planned}</b> 件
        </span>
        <span className="text-gray-500">
          已完成 <b className="text-emerald-700">{t.done}</b>
        </span>
        <span className="text-gray-500">
          待跑 <b className="text-gray-900">{t.queued}</b>
        </span>
        <span className="text-gray-500">
          要处理 <b className={t.attention > 0 ? 'text-red-600' : 'text-gray-900'}>{t.attention}</b>
        </span>
        {device.quotas.map((q) => (
          <span key={q.dept} className="text-gray-500">
            {q.dept}额度{' '}
            <b className="text-gray-900">
              {q.used}/{q.cap}
              {q.unit}
            </b>
            <span className="ml-1 text-[11px] text-gray-400">还能加 {Math.max(0, q.cap - q.used)}</span>
          </span>
        ))}
      </div>

      <Bar t={t} />

      <div className="mt-3">
        <div className="text-xs font-medium text-gray-500">接下来要跑的</div>
        {groups.length === 0 ? (
          <div className="py-2 text-sm text-gray-400">今天的活都跑完了</div>
        ) : (
          <div className="mt-1 space-y-2">
            {groups.map((g) => (
              <div key={g.dept}>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${DEPT_DOT[g.dept]}`} />
                  {g.dept}
                  <span className="text-gray-400">{g.items.length} 件</span>
                </div>
                <ul className="mt-0.5 divide-y">
                  {g.items.map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5 py-1.5 text-sm">
                      <span className="w-11 shrink-0 tabular-nums text-xs text-gray-400">{hhmm(s.planned_at)}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{s.title}</span>
                      {s.status === 'blocked' && (
                        <span
                          className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-700 ring-1 ring-orange-200"
                          title={s.blocked_reason}
                        >
                          {s.blocked_reason || '被挡住'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
