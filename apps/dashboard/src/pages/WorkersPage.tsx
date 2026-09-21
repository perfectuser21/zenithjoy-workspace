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
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { fetchWorkers, workerLiveUrl, type Worker } from '../api/workers.api';
import { fetchSchedule, slotsOfDay, DEPTS, type Dept, type ScheduleDevice } from '../api/schedule.api';
import DispatchJobDialog from '../components/DispatchJobDialog';
import DeptTaskTable from '../components/DeptTaskTable';
import DeviceRail from '../components/DeviceRail';
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
  // 读不到 ≠ 今天没活：后台断了要说"读取失败"，不能让空排期冒充"今天没安排"
  const [staleMsg, setStaleMsg] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  // 派完单立刻重拉一次，不用等下一轮轮询
  const [reloadKey, setReloadKey] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [dept, setDept] = useState<Dept | '全部'>('全部');
  const [picked, setPicked] = useState<string | null>(null);
  /** 鼠标划到的时刻：表格与占用条靠它互相高亮 */
  const [hoverAt, setHoverAt] = useState<number | null>(null);

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
    const load = () => {
      fetchSchedule().then((d) => {
        if (!alive) return;
        setSched(d.devices);
        setMock(d.mock);
        setAsOf(d.as_of);
        setStaleMsg(d.stale ? (d.stale_reason || '排程数据已停更') : null);
      });
    };
    load();
    // 排期是给人当天看着用的，开一分钟一次的轮询；停更会通过 stale 条自己冒出来
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [reloadKey]);

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
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,.06),0_8px_24px_-16px_rgba(15,23,42,.18)]">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">工作机</h1>
          <p className="text-gray-600">还没有工作机。安装 Agent 并用你的 license 注册后，它会出现在这里。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="rounded-2xl bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,.06),0_8px_24px_-16px_rgba(15,23,42,.18)]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900">工作机</h1>
          {mock && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-100">
              排期为样例数据，后端接入前仅供看形
            </span>
          )}
          {staleMsg && (
            <span
              role="alert"
              className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] text-rose-700 ring-1 ring-rose-100"
            >
              读取失败 · {staleMsg}
              {asOf ? ` · 数据截至 ${new Date(asOf).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
              —— 下面看到的可能不是真的
            </span>
          )}

          <button
            onClick={() => setDispatchOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
          >
            <Plus className="h-4 w-4" />
            派活
          </button>

          <div className="flex items-center overflow-hidden rounded-lg ring-1 ring-neutral-200">
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

        {/* 一排机器芯片 + 部门筛选：主理人要求顶部压成两行，省出的纵向空间给表格 */}
        <div data-testid="filter-bar" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {rows.map((r) => {
            const on = current?.id === r.id;
            return (
              <button
                key={r.id}
                data-testid="device-chip"
                onClick={() => setPicked(r.id)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  on
                    ? 'bg-neutral-900 text-white shadow-sm'
                    : 'bg-neutral-50 text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-100'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${r.online ? 'bg-emerald-400' : 'bg-neutral-300'}`} />
                {r.name}
                <span className="text-neutral-400">{r.todayCount} 件</span>
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px bg-neutral-200" />

          {(['全部', ...DEPTS] as const).map((x) => (
            <button
              key={x}
              onClick={() => {
                setDept(x);
                setPicked(null);
              }}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                dept === x ? 'bg-sky-600 text-white' : 'text-neutral-500 ring-1 ring-neutral-200 hover:bg-neutral-50'
              }`}
            >
              {x}
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
            {DEPTS.map((d) => (
              <span key={d} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-sm ${DEPT_BLOCK[d].bar}`} />
                {d}
              </span>
            ))}
          </div>
        </div>

        {!current ? (
          <div className="mt-4 rounded-2xl py-12 text-center text-sm text-neutral-400 ring-1 ring-neutral-200/80">没有匹配的设备</div>
        ) : (
          <div className="mt-4 flex flex-col gap-5 lg:flex-row">
            <DeviceRail
              name={current.name}
              serial={current.serial}
              online={current.online}
              href={`/dashboard/workers/${current.id}`}
              liveUrl={workerLiveUrl(current.id)}
              slots={current.device?.slots ?? []}
              dayOffset={offset}
              runningText={
                current.running
                  ? `${current.running.title}（第 ${current.running.current_step}/${current.running.steps_total} 步）`
                  : undefined
              }
              quotas={current.device?.quotas}
            />

            <DeptTaskTable
              slots={current.device?.slots ?? []}
              dayOffset={offset}
              noSchedule={!current.device}
              quotas={current.device?.quotas}
              onHoverAt={setHoverAt}
              highlightAt={hoverAt}
            />
          </div>
        )}
      </div>

      {dispatchOpen && (
        <DispatchJobDialog
          devices={sched}
          defaultAgentId={current?.id ?? null}
          onClose={() => setDispatchOpen(false)}
          onDone={() => setReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
