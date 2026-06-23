/**
 * CsOneClickSetupPage — 微信客服「一键配置 / 我的客服机」(2026-06-23 老板拍板)
 *
 * 不让人手抄 machine_id：机器装好 Agent 自己注册上来报到 → 这里列出「我的全部客服机」(已配+待配)。
 * 点任意一台 → 填/改 人设名 / 白名单 / 关键人 / 自动回复开关 → 点【设置完毕】→ 后端自动绑定+写配置。
 * 已配的机器点进去会预填当前白名单，方便随时改；约 30 秒生效，去微信发条消息即可验证。
 */
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, RefreshCw, MonitorSmartphone } from 'lucide-react';

interface CSMachine {
  machine_id: string;
  hostname?: string;
  last_seen?: string;
  configured: boolean;
  wechat_id?: string;
  self_name?: string;
  whitelist?: string[];
  auto_agent_enabled?: boolean;
}

export default function CsOneClickSetupPage() {
  const [machines, setMachines] = useState<CSMachine[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [selfName, setSelfName] = useState('');
  const [keyContact, setKeyContact] = useState('');
  const [whitelist, setWhitelist] = useState('');
  const [autoAgent, setAutoAgent] = useState(true);
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

  // 选中一台机器：已配的把它当前配置预填进表单，方便直接改白名单。
  const selectMachine = (m: CSMachine) => {
    setMachineId(m.machine_id);
    setDone(null);
    setError(null);
    if (m.configured) {
      setSelfName(m.self_name ?? '');
      setWhitelist((m.whitelist ?? []).join(', '));
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
    if (!selfName.trim()) {
      setError('填一个客服人设名（比如：小助手）');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/wechat/cs/setup/${encodeURIComponent(machineId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: {
            self_name: selfName.trim(),
            address_style: '亲切',
            tone: '友好专业',
            sentence_style: '简洁',
            use_emoji: '少量',
            banned_phrases: [],
            few_shot: [],
          },
          auto_agent_enabled: autoAgent,
          key_contact_wechat: keyContact.trim(),
          whitelist: whitelist
            .split(/[\n,，、]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || data.error || '设置失败');
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
        装好 Agent 的机器会自己报到。点一台 → 填/改 人设·白名单·开关 → 点设置完毕，约 30 秒生效。已配过的也能点进去改。
      </p>

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
                className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${
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
                />
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
                {m.configured ? (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    已配{m.whitelist?.length ? ` · 白名单${m.whitelist.length}人` : ''}
                  </span>
                ) : (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    待配置
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ② 填配置 */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-5 mb-4 space-y-4">
        <h3 className="font-medium text-gray-900 dark:text-white">② 填配置</h3>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">客服人设名</label>
          <input
            data-testid="setup-self-name"
            value={selfName}
            onChange={(e) => setSelfName(e.target.value)}
            placeholder="比如：小助手"
            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">
            白名单（名单内客户才自动回，逗号/换行分隔）
          </label>
          <textarea
            data-testid="setup-whitelist"
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
            placeholder="默忆, 客户A, 客户B"
            rows={2}
            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-900 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 dark:text-gray-300 mb-1">关键人（上下线播报给谁）</label>
          <input
            data-testid="setup-key-contact"
            value={keyContact}
            onChange={(e) => setKeyContact(e.target.value)}
            placeholder="比如：默忆"
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
            设置成功（客服号 {done}）。机器约 30 秒内拉到配置生效，去微信让名单内的人发条消息验证即可。
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
