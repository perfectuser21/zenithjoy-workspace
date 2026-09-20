/**
 * 工作机控制塔 · 总览（/dashboard/workers）
 *
 * 主理人 0920：
 *   「应该在工作机页面里直接有个 calendar，每一天、一周我都能看得到，
 *     而不是再弄个新的页面。」→ 排程内嵌，不做独立排程页
 *   「我要的是一个机子，左边一个手机，右边是一个固定的窗口高度。你现在随着任务
 *     越来越多，这个页面越来越长，不是这个样子……一个页面里面一个机器这样去看。」
 *     → 一屏只看一台：顶部芯片切机，左边该机实时画面，右边当天的任务表
 *   「我觉得一个 table 的形式会比较好……每个部门从早到晚是怎么排的，以 table 的形式去分；
 *     页面的高度是定的就这一页，里面可以加一个上下滑杆。」
 *     → 右边是按部门分组的 DeptTaskTable，容器高度写死、滚动发生在表里
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchWorkers, workerLiveUrl, type Worker } from '../api/workers.api';
import { fetchSchedule, slotsOfDay, DEPTS, type Dept, type ScheduleDevice } from '../api/schedule.api';
import DeptTaskTable from '../components/DeptTaskTable';
import PhoneFrame from '../components/PhoneFrame';
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
  const [picked, setPicked] = useState<string | null>(null);

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
        id: w.id,
        device: d,
        name: d?.name || w.nickname || w.hostname,
        serial: d?.serial,
        online: w.status === 'online',
        running: w.running,
        todayCount: d ? slotsOfDay(d.slots, offset).length : 0,
      }));
  }, [workers, sched, dept, offset]);

  // 选中的机被筛掉了就退回第一台，右边永远有内容
  const current = rows.find((r) => r.id === picked) ?? rows[0];

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

          <div className="ml-auto flex items-center overflow-hidden rounded-lg border">
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
          {offset !== 0 && (
            <button onClick={() => setOffset(0)} className="text-xs text-blue-600 hover:underline">
              回到今天
            </button>
          )}
        </div>

        {/* 一排机器芯片：点哪台看哪台，不再把所有机器的排期往下堆 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {rows.map((r) => {
            const on = current?.id === r.id;
            return (
              <button
                key={r.id}
                data-testid="device-chip"
                onClick={() => setPicked(r.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ring-1 ${
                  on ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${r.online ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                {r.name}
                <span className={on ? 'text-gray-300' : 'text-gray-400'}>{r.todayCount} 件</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(['全部', ...DEPTS] as const).map((x) => (
              <button
                key={x}
                onClick={() => {
                  setDept(x);
                  setPicked(null);
                }}
                className={`rounded-full px-3 py-1 text-xs ring-1 ${
                  dept === x ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                {x}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            {DEPTS.map((d) => (
              <span key={d} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-sm ${DEPT_BLOCK[d].bar}`} />
                {d}
              </span>
            ))}
          </div>
        </div>

        {!current ? (
          <div className="mt-3 rounded-xl border py-10 text-center text-sm text-gray-400">没有匹配的设备</div>
        ) : (
          <div className="mt-3 flex flex-col gap-4 lg:flex-row">
            <div className="shrink-0 lg:w-[300px]">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{current.name}</span>
                {current.serial && <span className="text-xs text-gray-400">{current.serial}</span>}
                <Link to={`/dashboard/workers/${current.id}`} className="ml-auto text-xs text-blue-600 hover:underline">
                  看步骤流 →
                </Link>
              </div>
              <PhoneFrame>
                <img alt="实时画面" src={workerLiveUrl(current.id)} className="h-full w-full object-contain" />
              </PhoneFrame>
              <div className="mt-2 text-xs text-gray-500">
                {current.running ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 ring-1 ring-amber-200">
                    正在跑：{current.running.title}（第 {current.running.current_step}/{current.running.steps_total} 步）
                  </span>
                ) : (
                  '空闲'
                )}
              </div>
            </div>

            <DeptTaskTable
              slots={current.device?.slots ?? []}
              dayOffset={offset}
              noSchedule={!current.device}
              quotas={current.device?.quotas}
            />
          </div>
        )}
      </div>
    </div>
  );
}
