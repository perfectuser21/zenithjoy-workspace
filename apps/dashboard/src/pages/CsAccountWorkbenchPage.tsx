/**
 * CsAccountWorkbenchPage — 微信客服「单号工作台」(以号为中心 IA 重设计 刀2)
 *
 * 路由：/wechat/account/:machineId（与现有 /wechat/cs/setup/:machineId 同口径用 machine_id）。
 * 一个号一个上下文：顶部状态条（在线 · 微信登录态 · 今日数据 · 真发/演练）+ 5 个 Tab：
 *   人设话术 / 知识库 / 运营设置 / 客户 / 成效
 * 每个 Tab 复用现有页面组件（embedded 模式，从工作台号 context 取号，不再各自选择号）：
 *   - 人设话术 + 知识库 → WechatCustomerServiceConfigPage（section=persona / kb，每号已每号化）
 *   - 运营设置 → CsOneClickSetupPage（embedded，固定到该机器）
 *   - 客户 → CustomerListPage（按该号 cs_wechat_id 过滤名册）
 *   - 成效 → CsWorkStatsPage（按该号 cs_wechat_id 过滤工作汇总）
 *
 * 可见性：listCSMachines 已按账号租户 scope（运营只看自己号 / 超管看全部）。
 *   URL 直敲别人号 → 该 machineId 不在 scoped 列表 → 前端兜底「无权访问」（后端各接口仍各自 scope）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ArrowLeft, MessageCircle, BookOpen, Settings, Users, BarChart3 } from 'lucide-react';
import { listCSMachines, type CSMachine } from '../api/wechat-cs-config.api';
import { wechatCsStatsApi } from '../api/wechat-cs-stats.api';
import ListenerHealthSection from '../components/ListenerHealthSection';
import WechatCustomerServiceConfigPage from './WechatCustomerServiceConfigPage';
import CsOneClickSetupPage from './CsOneClickSetupPage';
import CustomerListPage from './CustomerListPage';
import CsWorkStatsPage from './CsWorkStatsPage';

type TabKey = 'persona' | 'kb' | 'settings' | 'customers' | 'stats';

const TABS: { key: TabKey; label: string; Icon: typeof MessageCircle }[] = [
  { key: 'persona', label: '人设话术', Icon: MessageCircle },
  { key: 'kb', label: '知识库', Icon: BookOpen },
  { key: 'settings', label: '运营设置', Icon: Settings },
  { key: 'customers', label: '客户', Icon: Users },
  { key: 'stats', label: '成效', Icon: BarChart3 },
];

export default function CsAccountWorkbenchPage() {
  const { machineId = '' } = useParams<{ machineId: string }>();
  const [machines, setMachines] = useState<CSMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('persona');
  const [todayServed, setTodayServed] = useState<number | null>(null);

  const machine = useMemo(
    () => machines.find((m) => m.machine_id === machineId),
    [machines, machineId],
  );
  const wechatId = machine?.wechat_id ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCSMachines();
      setMachines(list);
    } catch {
      setMachines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 今日接待数（成效摘要进状态条）：拉今天 stats，取本号那行的 served_customers。
  useEffect(() => {
    if (!wechatId) {
      setTodayServed(null);
      return;
    }
    let cancelled = false;
    void wechatCsStatsApi
      .getStats('today')
      .then((stats) => {
        if (cancelled) return;
        const row = stats.find((s) => s.cs_wechat_id === wechatId);
        setTodayServed(row?.served_customers ?? 0);
      })
      .catch(() => {
        if (!cancelled) setTodayServed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wechatId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="cs-workbench-loading">
        <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
      </div>
    );
  }

  // 可见性兜底：scoped 列表里没有这个 machineId → 不是自己的号（或不存在）。
  if (!machine) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center" data-testid="cs-workbench-forbidden">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">无权访问该客服号</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          这个客服号不在你的可见范围内（运营只能进自己绑定的号）。
        </p>
        <Link to="/wechat/accounts" className="text-sm text-sky-600 dark:text-sky-400 hover:underline">
          ← 回客服号总览
        </Link>
      </div>
    );
  }

  const title = machine.self_name || machine.hostname || machine.machine_id.slice(0, 8) + '…';
  const wechatLoginText = machine.found_window
    ? '微信已登录'
    : machine.login_present
      ? '微信需扫码'
      : '未找到微信';

  return (
    <div className="max-w-5xl mx-auto" data-testid="cs-workbench">
      {/* 返回总览 */}
      <Link
        to="/wechat/accounts"
        data-testid="cs-workbench-back"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 mb-3"
      >
        <ArrowLeft className="w-4 h-4" /> 客服号总览
      </Link>

      {/* ── 顶部状态条：在线 · 微信登录态 · 今日数据 · 真发/演练 ── */}
      <div
        data-testid="cs-workbench-statusbar"
        className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 mb-5"
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white truncate" data-testid="cs-workbench-title">
                {title}
              </h2>
              {machine.real_wechat_id && (
                <span className="text-xs font-mono text-gray-400">（{machine.real_wechat_id}）</span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{machine.hostname || machine.machine_id}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span
              className={`px-2 py-0.5 rounded-full ${
                machine.online
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400'
              }`}
            >
              {machine.online ? '● 在线' : '○ 离线'}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full ${
                machine.found_window
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              }`}
            >
              {wechatLoginText}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              今日接待 {todayServed ?? '—'} 人
            </span>
            <span
              data-testid="cs-workbench-mode"
              className={`px-2 py-0.5 rounded-full ${
                machine.auto_agent_enabled
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              }`}
            >
              {machine.auto_agent_enabled ? '真发' : '演练'}
            </span>
          </div>
        </div>
        {/* 监听健康（单号视角，过滤到本号） */}
        <div className="mt-4">
          <ListenerHealthSection filterWechatId={wechatId} filterAgentId={machine.agent_id} />
        </div>
      </div>

      {/* ── 5 Tab ── */}
      <div className="flex gap-1 mb-5 flex-wrap border-b border-slate-200 dark:border-slate-700">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            data-testid={`cs-tab-${key}`}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab 内容（复用现有页面组件，embedded 模式按本号 context）── */}
      <div data-testid={`cs-tab-panel-${tab}`}>
        {tab === 'persona' &&
          (wechatId ? (
            <WechatCustomerServiceConfigPage embedded wechatId={wechatId} section="persona" />
          ) : (
            <NeedBindHint />
          ))}
        {tab === 'kb' &&
          (wechatId ? (
            <WechatCustomerServiceConfigPage embedded wechatId={wechatId} section="kb" />
          ) : (
            <NeedBindHint />
          ))}
        {tab === 'settings' && <CsOneClickSetupPage embedded fixedMachineId={machineId} />}
        {tab === 'customers' &&
          (wechatId ? <CustomerListPage csWechatId={wechatId} /> : <NeedBindHint />)}
        {tab === 'stats' &&
          (wechatId ? <CsWorkStatsPage filterWechatId={wechatId} /> : <NeedBindHint />)}
      </div>
    </div>
  );
}

// 该号还没绑定微信号时，依赖 cs_wechat_id 的 Tab 给出引导。
function NeedBindHint() {
  return (
    <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400" data-testid="cs-need-bind">
      这个号还没绑定微信号。请先到「运营设置」Tab 点「设置完毕」完成绑定，再回来配置/查看。
    </div>
  );
}
