/**
 * 派活面板 —— 主理人在工作机页点「派活」后弹出的那个框（task 3abb7f8c）
 *
 * 一件事说清楚：**这里排的是时间窗口，不是精确时刻**。
 * 对外动作（私信/发布/点赞）固定整点发送等于向平台自首（铁律 27bb6d1a），所以窗口
 * 不得窄于 30 分钟，系统在窗口内挑一个不规律的点去跑，跑完告诉你实际几点跑的。
 * 不碰平台的活（视频剪辑）没这个约束，"就现在"也行。
 *
 * 后端的拒绝理由一律原样显示 —— 用户得知道是窗口太窄、额度不够，还是设备不是他的。
 */
import { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { dispatchJob, DEPTS, type Dept, type ScheduleDevice } from '../api/schedule.api';

/** 会碰平台的业务线：这些活受窗口约束 */
const OUTBOUND: ReadonlySet<string> = new Set(['智能获客', '新媒体部', '私域客服']);
export function isOutboundDept(dept: string): boolean {
  return OUTBOUND.has(dept);
}

export interface WindowPreset {
  label: string;
  /** 从现在起推迟多久开窗 */
  delayMinutes: number;
  /** 窗口宽度；0 = 精确到分（只对内动作开放） */
  minutes: number;
}

/** 窗口预设：对外动作最窄 30 分钟，对内动作可以"就现在" */
export function windowPresets(dept: string): WindowPreset[] {
  const outbound: WindowPreset[] = [
    { label: '接下来半小时内', delayMinutes: 1, minutes: 30 },
    { label: '接下来一小时内', delayMinutes: 1, minutes: 60 },
    { label: '今晚 20:00–22:00', delayMinutes: -1, minutes: 120 },
  ];
  if (isOutboundDept(dept)) return outbound;
  return [{ label: '就现在', delayMinutes: 0, minutes: 0 }, ...outbound];
}

/** 可派的动作。与工作机上 douyin-phone-adb 的子命令一一对应。 */
const ACTIONS = [
  { value: 'open-search', label: '在抖音里搜一个词', needsArg: true, argLabel: '搜索词' },
  { value: 'open-app', label: '打开某个 App', needsArg: true, argLabel: '包名' },
  { value: 'screencap', label: '截一张屏', needsArg: false, argLabel: '' },
  { value: 'wake', label: '唤醒屏幕', needsArg: false, argLabel: '' },
] as const;

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
  const [action, setAction] = useState<string>(ACTIONS[0].value);
  const [arg, setArg] = useState('');
  const [presetIdx, setPresetIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presets = useMemo(() => windowPresets(dept), [dept]);
  const preset = presets[Math.min(presetIdx, presets.length - 1)];
  const actionMeta = ACTIONS.find((a) => a.value === action) ?? ACTIONS[0];
  const device = devices.find((d) => d.agent_id === agentId);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { start, end } = windowRange(preset);
      await dispatchJob({
        agent_id: agentId,
        dept,
        title: `${actionMeta.label}${arg ? ` · ${arg}` : ''}`,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        est_minutes: 2,
        params: {
          action,
          // 领单器缺 profile 时用机身序列号兜底，这里能给就给准的
          profile: device?.serial,
          arg: arg || undefined,
        },
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
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900">派一件活</h2>
          <button aria-label="关闭" onClick={onClose} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {devices.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-500">没有可派单的设备。先让工作机连上，再回来派活。</p>
        ) : (
          <div className="mt-4 space-y-3">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dj-dept" className="mb-1 block text-xs text-neutral-500">部门</label>
                <select id="dj-dept" aria-label="部门" className={field} value={dept}
                  onChange={(e) => { setDept(e.target.value as Dept); setPresetIdx(0); }}>
                  {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="dj-action" className="mb-1 block text-xs text-neutral-500">干什么</label>
                <select id="dj-action" aria-label="干什么" className={field} value={action} onChange={(e) => setAction(e.target.value)}>
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="dj-arg" className="mb-1 block text-xs text-neutral-500">
                {actionMeta.needsArg ? actionMeta.argLabel : '关键词 / 参数（这个动作用不上）'}
              </label>
              <input id="dj-arg" aria-label="关键词 / 参数" className={field} value={arg}
                disabled={!actionMeta.needsArg}
                placeholder={actionMeta.needsArg ? actionMeta.argLabel : '—'}
                onChange={(e) => setArg(e.target.value)} />
            </div>

            <div>
              <label htmlFor="dj-window" className="mb-1 block text-xs text-neutral-500">什么时候跑</label>
              <select id="dj-window" aria-label="什么时候跑" className={field} value={presetIdx}
                onChange={(e) => setPresetIdx(Number(e.target.value))}>
                {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                {isOutboundDept(dept)
                  ? '这类活会碰平台：你排的是一个时间段，系统在段里挑个不规律的点去跑，跑完告诉你具体几点几分——固定整点发送等于向平台自首。'
                  : '这类活不碰平台，你说几点就几点。'}
              </p>
            </div>

            {err && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">{err}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">取消</button>
              <button onClick={submit} disabled={busy || !agentId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                派下去
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
