/**
 * 派活面板（task 3abb7f8c）
 *
 * 主理人的原话：「不同部门有哪些工作，列出来之后我去点它，你应该让我输入某些关键词
 * ——针对这个工作流的输入到底有哪些。」
 *
 * 所以是**两步**，不是一屏堆完（decision c4f24a3d）：
 *   第 1 步「派给谁、派什么」：设备 + 部门 + 这个部门有哪些活
 *   第 2 步「<这件活>」      ：只有这件活要填的东西 + 什么时候跑，带返回
 *
 * 第 2 步刻意**不再摆设备与部门下拉**——那两个正是「所有任务挤到一个面」的来源；
 * 改成一行只读上下文，要换设备就返回第 1 步。
 *
 * 不暴露 adb 原语（搜词/打开 App/截屏）——那是工程师视角，不是「派一件活」。
 *
 * 另一件说清楚的事：**这里排的是时间窗口，不是精确时刻**。碰平台的活固定整点发送
 * 等于向平台自首（铁律 27bb6d1a），所以窗口不得窄于 30 分钟，系统在窗口内挑一个
 * 不规律的点去跑，跑完告诉你实际几点几分。
 */
import { useMemo, useState } from 'react';
import { X, Loader2, ChevronLeft } from 'lucide-react';
import { dispatchJob, DEPTS, type Dept, type ScheduleDevice } from '../api/schedule.api';
import {
  jobsOfDept,
  initialValues,
  validateValues,
  buildJobParams,
  buildJobTitle,
  type JobDef,
} from '../api/job-catalog';

export interface WindowPreset {
  label: string;
  /** 从现在起推迟多久开窗；-1 表示"今晚 20:00" */
  delayMinutes: number;
  /** 窗口宽度；0 = 精确到分（只对不碰平台的活开放） */
  minutes: number;
}

/** 窗口预设：碰平台的活最窄 30 分钟，不碰的可以"就现在" */
export function windowPresets(outbound: boolean): WindowPreset[] {
  const wide: WindowPreset[] = [
    { label: '接下来半小时内', delayMinutes: 1, minutes: 30 },
    { label: '接下来一小时内', delayMinutes: 1, minutes: 60 },
    { label: '今晚 20:00–22:00', delayMinutes: -1, minutes: 120 },
  ];
  return outbound ? wide : [{ label: '就现在', delayMinutes: 0, minutes: 0 }, ...wide];
}

/** 今晚 20:00（本地时区）；已经过了就顺延到明晚 */
function tonightAt20(): Date {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function windowRange(p: WindowPreset): { start: Date; end: Date } {
  if (p.delayMinutes === -1) {
    const start = tonightAt20();
    return { start, end: new Date(start.getTime() + p.minutes * 60_000) };
  }
  const start = new Date(Date.now() + p.delayMinutes * 60_000);
  return { start, end: new Date(start.getTime() + p.minutes * 60_000) };
}

interface Props {
  devices: ScheduleDevice[];
  defaultAgentId: string | null;
  onClose: () => void;
  onDone: () => void;
}

export default function DispatchJobDialog({ devices, defaultAgentId, onClose, onDone }: Props) {
  const [agentId, setAgentId] = useState(defaultAgentId ?? devices[0]?.agent_id ?? '');
  const [dept, setDept] = useState<Dept>('智能获客');
  const [jobId, setJobId] = useState<string>('');
  // 按活分别存：返回第 1 步再点回同一件活时，填到一半的值还在；点另一件活各用各的，
  // 绝不会把上一件的输入带过去。
  const [valuesByJob, setValuesByJob] = useState<Record<string, Record<string, string>>>({});
  const [presetIdx, setPresetIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const jobs = useMemo(() => jobsOfDept(dept), [dept]);
  const job: JobDef | undefined = jobs.find((j) => j.id === jobId);
  // 有选中的活 = 已经进到第 2 步
  const step: 'pick' | 'fill' = job ? 'fill' : 'pick';
  const values = (jobId && valuesByJob[jobId]) || {};
  const setValues = (fn: (v: Record<string, string>) => Record<string, string>) =>
    setValuesByJob((all) => ({ ...all, [jobId]: fn(all[jobId] ?? {}) }));
  const presets = useMemo(() => windowPresets(job?.outbound ?? true), [job?.outbound]);
  const preset = presets[Math.min(presetIdx, presets.length - 1)];

  const pickJob = (j: JobDef) => {
    setJobId(j.id);
    // 这件活之前填过就接着填，没填过才铺默认值
    setValuesByJob((all) => (all[j.id] ? all : { ...all, [j.id]: initialValues(j) }));
    setPresetIdx(0);
    setErr(null);
  };

  /** 回第 1 步重新挑。填过的值留着——回去看一眼再回来，值没了会恼人。 */
  const backToPick = () => {
    setJobId('');
    setErr(null);
  };

  const submit = async () => {
    if (!job) return;
    const bad = validateValues(job, values);
    if (bad) { setErr(bad); return; }
    setBusy(true);
    setErr(null);
    try {
      const { start, end } = windowRange(preset);
      await dispatchJob({
        agent_id: agentId,
        dept,
        title: buildJobTitle(job, values),
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        est_minutes: job.estMinutes,
        params: buildJobParams(job, values),
      });
      onDone();
      onClose();
    } catch (e) {
      // 后端的人话原因原样展示：窗口太窄 / 额度不够 / 设备不是你的
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          {step === 'fill' && job ? (
            <div className="flex min-w-0 items-center gap-2">
              <button
                onClick={backToPick}
                disabled={busy}
                aria-label="返回"
                className="-ml-1 rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="truncate text-base font-semibold text-neutral-900">{job.label}</h2>
            </div>
          ) : (
            <h2 className="text-base font-semibold text-neutral-900">派一件活</h2>
          )}
          <button aria-label="关闭" onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {devices.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-500">没有可派单的设备。先让工作机连上，再回来派活。</p>
        ) : (
          <div className="mt-4 space-y-3">
            {step === 'pick' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dj-device" className="mb-1 block text-xs text-neutral-500">设备</label>
                <select id="dj-device" aria-label="设备" className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {devices.map((d) => (
                    <option key={d.agent_id} value={d.agent_id}>
                      {d.name}{d.online ? '' : '（离线，到点可能不跑）'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dj-dept" className="mb-1 block text-xs text-neutral-500">部门</label>
                <select id="dj-dept" aria-label="部门" className={field} value={dept}
                  onChange={(e) => { setDept(e.target.value as Dept); setJobId(''); setValuesByJob({}); setErr(null); }}>
                  {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            )}

            {/* 第 1 步：这个部门有哪些活 */}
            {step === 'pick' && (
            <div>
              <span className="mb-1 block text-xs text-neutral-500">这个部门可以派的活</span>
              {jobs.length === 0 ? (
                <p data-testid="no-jobs" className="rounded-lg bg-neutral-50 px-3 py-3 text-xs leading-relaxed text-neutral-500">
                  「{dept}」在这台机器上还没有可派的活。
                  <br />
                  它的活目前不从工作机走（发布在客户端那条链上、剪辑在别的机器），接进来之后会出现在这里。
                </p>
              ) : (
                <div className="space-y-1.5">
                  {jobs.map((j) => {
                    const on = j.id === jobId;
                    return (
                      <button
                        key={j.id}
                        data-testid="job-option"
                        onClick={() => pickJob(j)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        <div className="text-sm">{j.label}</div>
                        <div className={`mt-0.5 text-[11px] leading-relaxed ${on ? 'text-neutral-300' : 'text-neutral-500'}`}>
                          {j.summary}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {/* 第 2 步：这件活要填什么。设备与部门退成一行只读上下文——
                再摆两个下拉在这儿，就又回到"所有东西挤在一个面"了。 */}
            {step === 'fill' && job && (
              <>
                <p data-testid="dispatch-context" className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                  派给 <span className="text-neutral-700">{devices.find((d) => d.agent_id === agentId)?.name ?? agentId}</span>
                  {' · '}{dept}
                  <span className="text-neutral-400">（要换设备就点左上角返回）</span>
                </p>
                {job.fields.length === 0 ? (
                  <p data-testid="no-fields" className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                    这件活不用填什么，直接派就行。
                  </p>
                ) : (
                  job.fields.map((f) => (
                    <div key={f.name}>
                      <label htmlFor={`dj-f-${f.name}`} className="mb-1 block text-xs text-neutral-500">
                        {f.label}{f.required ? '' : '（可不填）'}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea id={`dj-f-${f.name}`} aria-label={f.label} className={`${field} min-h-[72px]`}
                          placeholder={f.placeholder} value={values[f.name] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                      ) : (
                        <input id={`dj-f-${f.name}`} aria-label={f.label} className={field}
                          inputMode={f.type === 'number' ? 'numeric' : undefined}
                          placeholder={f.placeholder} value={values[f.name] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
                      )}
                      {f.help && <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{f.help}</p>}
                    </div>
                  ))
                )}

                <div>
                  <label htmlFor="dj-window" className="mb-1 block text-xs text-neutral-500">什么时候跑</label>
                  <select id="dj-window" aria-label="什么时候跑" className={field} value={presetIdx}
                    onChange={(e) => setPresetIdx(Number(e.target.value))}>
                    {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                  </select>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                    {job.outbound
                      ? '这类活会碰平台：你排的是一个时间段，系统在段里挑个不规律的点去跑，跑完告诉你具体几点几分——固定整点发送等于向平台自首。'
                      : '这类活不碰平台，你说几点就几点。'}
                  </p>
                </div>
              </>
            )}

            {err && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">{err}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} disabled={busy}
                className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-40">取消</button>
              {/* 第 1 步还没选活，没什么可派——不摆这个按钮，免得以为漏填了什么 */}
              {step === 'fill' && (
                <button onClick={submit} disabled={busy || !agentId || !job}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  派下去
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
