/**
 * CsOneClickSetupPage — 微信客服「我的客服机」(整合后；2026-06-25 整合拍板)
 *
 * 不让人手抄 machine_id：机器装好 Agent 自己注册上来报到 → 这里列出「我的全部客服机」(已配+待配)。
 * 点任意一台 → 填/改 营业时间 / 每日上限 / 真发开关 → 点【设置完毕】→ 后端自动绑定+写配置。
 * IA 重设计刀1：人设（含人设名 self_name）已移到「话术知识库」页每号编辑，本页只留运营参数 + 绑定；
 * 机器卡上仍展示该号人设名（只读快速标签）。约 30 秒生效，去微信发条消息即可验证。
 */
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, RefreshCw, MonitorSmartphone } from 'lucide-react';
import ListenerHealthSection from '../components/ListenerHealthSection';

interface CSMachine {
  machine_id: string;
  hostname?: string;
  last_seen?: string;
  configured: boolean;
  wechat_id?: string;
  self_name?: string;
  auto_agent_enabled?: boolean;
  online?: boolean;
  wechat_ok?: boolean;
  wechat_reason?: string;
  found_window?: boolean;
  login_present?: boolean;
}

// 从任意后端错误响应里抽出「可读字符串」。绝不返回对象——渲染对象会让 React 崩溃白屏。
//   扁平：{ message } / { error: 'xxx' }
//   嵌套（cs-config-guard 安全闸 / tenantContext）：{ error: { code, message } }
function errorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : null;
  const d = data as Record<string, unknown>;
  if (typeof d.message === 'string' && d.message) return d.message;
  if (typeof d.error === 'string' && d.error) return d.error;
  if (d.error && typeof d.error === 'object') {
    const e = d.error as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) return e.message;
    if (typeof e.code === 'string' && e.code) return e.code;
  }
  return null;
}

export default function CsOneClickSetupPage() {
  const [machines, setMachines] = useState<CSMachine[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [autoAgent, setAutoAgent] = useState(true);
  const [businessHoursStart, setBusinessHoursStart] = useState('09:00');
  const [businessHoursEnd, setBusinessHoursEnd] = useState('21:00');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMachines = async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/wechat/cs/machines');
      const data = await res.json();
      setMachines(Array.isArray(data.machines) ? data.machines : []);
    } catch {
      setMachines([]);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadMachines();
  }, []);

  // 选中一台机器：已配的把它当前配置预填进表单，方便直接改。
  const selectMachine = (m: CSMachine) => {
    setMachineId(m.machine_id);
    setDone(null);
    setError(null);
    if (m.configured) {
      setAutoAgent(m.auto_agent_enabled ?? true);
    }
  };

  const submit = async () => {
    setError(null);
    setDone(null);
    if (!machineId) {
      setError('先选一台机器');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/wechat/cs/setup/${encodeURIComponent(machineId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // IA 重设计刀1：本页只发运营参数 + 绑定；人设（含 self_name）/知识库在「话术知识库」页每号编辑。
          auto_agent_enabled: autoAgent,
          business_hours_start: businessHoursStart,
          business_hours_end: businessHoursEnd,
          daily_limit: Number.parseInt(dailyLimit, 10) || 0,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        // 后端错误形状不一：扁平 {message}/{error:'..'} 或安全闸的嵌套 {error:{code,message}}。
        // 必须取出「字符串」再 setError——直接把对象塞进 error state 渲染 {error} 会让 React 整树崩溃白屏。
        setError(errorMessage(data) ?? `设置失败（${res.status}）`);
        return;
      }
      setDone(data.wechat_id);
      loadMachines();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-white">微信客服 · 我的客服机</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        装好 Agent 的机器会自己报到。点一台 → 填/改 营业时间·每日上限·真发开关 → 点设置完毕，约 30 秒生效。
        人设·语气·话术·知识库去「话术知识库」页按号编辑；谁接管/谁拉黑去「客户好友表」按客户逐个开关。
      </p>

      {/* 监听健康看板（整合：客服机健康一处看） */}
      <ListenerHealthSection />

      {/* ① 选机器 */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
            <MonitorSmartphone className="w-4 h-4 text-sky-500" /> ① 选机器
          </h3>
          <button
            onClick={loadMachines}
            className="text-xs text-sky-600 dark:text-sky-400 flex items-center gap-1 hover:underline"
            data-testid="refresh-pending"
          >
            <RefreshCw className={`w-3 h-3 ${loadingList ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
        {machines.length === 0 ? (
          <p className="text-sm text-gray-400">
            还没有机器报到。请确认客户机装了 Agent、连上中台（它会自动报到）。
          </p>
        ) : (
          <div className="space-y-2">
            {machines.map((m) => (
              <label
                key={m.machine_id}
                className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                  machineId === m.machine_id
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="machine"
                  value={m.machine_id}
                  checked={machineId === m.machine_id}
                  onChange={() => selectMachine(m)}
                  data-testid="machine-radio"
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-700 dark:text-gray-200">
                      {m.hostname ? (
                        <>
                          <span className="font-medium">{m.hostname}</span>
                          <span className="font-mono text-xs text-gray-400 ml-2">{m.machine_id.slice(0, 8)}…</span>
                        </>
                      ) : (
                        <span className="font-mono">机器 {m.machine_id.slice(0, 12)}…</span>
                      )}
                    </span>
                    {/* 在线状态 */}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        m.online
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
                      }`}
                    >
                      {m.online ? '● 在线' : '○ 离线'}
                    </span>
                    {/* 配置状态 */}
                    {m.configured ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                        已配
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        待配置
                      </span>
                    )}
                    {/* 客服人设名（小苏小助手等）—— per-operator 重做：人设名归在「我的客服机」卡，不在客户列表 */}
                    {m.self_name && (
                      <span
                        data-testid="cs-machine-persona"
                        className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                      >
                        {m.self_name}{m.online ? ' 在线' : ''}
                      </span>
                    )}
                  </div>
                  {/* 微信健康：好了显绿，坏了显精确原因（整合诊断，一处看到） */}
                  {m.online && (
                    <div className="text-xs mt-1">
                      {m.wechat_ok ? (
                        <span className="text-green-600 dark:text-green-400">微信就绪，可自动回复</span>
                      ) : m.wechat_reason ? (
                        <span className="text-red-500">⚠ {m.wechat_reason}</span>
                      ) : null}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ② 填配置 */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 mb-4 space-y-4">
        <h3 className="font-medium text-gray-900 dark:text-white">② 填配置（运营参数）</h3>
        <p className="text-xs text-gray-400">
          人设名 / 语气 / 话术 / 知识库 去「话术知识库」页按号编辑（每号独立）。
        </p>
        {/* 营业时间 + 每日上限（Issue d2987606 补全后端已支持的配置项前台入口） */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">营业时间（开始）</label>
            <input
              type="time"
              data-testid="setup-business-hours-start"
              value={businessHoursStart}
              onChange={(e) => setBusinessHoursStart(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">营业时间（结束）</label>
            <input
              type="time"
              data-testid="setup-business-hours-end"
              value={businessHoursEnd}
              onChange={(e) => setBusinessHoursEnd(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">每日上限（每号每日自动回条数，0 = 不限）</label>
          <input
            type="number"
            min={0}
            data-testid="setup-daily-limit"
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            placeholder="50"
            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            data-testid="setup-auto-agent"
            checked={autoAgent}
            onChange={(e) => setAutoAgent(e.target.checked)}
          />
          自动回复开关（开 = 真发，关 = 只演练）
        </label>
      </div>

      <button
        onClick={submit}
        disabled={saving}
        data-testid="setup-submit"
        className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-medium disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        设置完毕
      </button>

      {done && (
        <div className="mt-4 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
          <div className="text-sm text-green-800 dark:text-green-300">
            设置成功（客服号 {done}）。机器约 30 秒内拉到配置生效，去微信让客户发条消息验证即可。
          </div>
        </div>
      )}
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
