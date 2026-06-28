/**
 * CsAccountOverviewPage — 微信客服「客服号总览」(以号为中心 IA 重设计 刀2)
 *
 * 路由：/wechat/accounts。超管/老板账号进这里看公司每个号一行：
 *   号(人设名/微信号) × [在线 · 微信健康 · 今日接待 · 真发/演练] → 点行下钻进单号工作台。
 * 数据全复用既有 scoped 接口：
 *   - GET /api/wechat/cs/machines（listAllMachines，已按租户 scope：超管全/运营自己）
 *   - GET /api/wechat/cs/stats?date=today（今日接待数，按 cs_wechat_id 匹配）
 * 可见性靠后端 scope（运营只会拿到自己的号），前端只渲染拿到的行。
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Download } from 'lucide-react';
import { listCSMachines, type CSMachine } from '../api/wechat-cs-config.api';
import { wechatCsStatsApi } from '../api/wechat-cs-stats.api';

export default function CsAccountOverviewPage() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<CSMachine[]>([]);
  const [servedByWid, setServedByWid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        listCSMachines(),
        wechatCsStatsApi.getStats('today').catch(() => []),
      ]);
      setMachines(list);
      const served: Record<string, number> = {};
      for (const s of stats) served[s.cs_wechat_id] = s.served_customers;
      setServedByWid(served);
    } catch {
      setMachines([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const wechatHealth = (m: CSMachine): { text: string; ok: boolean } => {
    if (!m.online) return { text: '离线', ok: false };
    if (m.found_window) return { text: '微信已登录', ok: true };
    if (m.login_present) return { text: '需扫码', ok: false };
    return { text: '未找到微信', ok: false };
  };

  return (
    <div className="max-w-5xl mx-auto" data-testid="cs-overview">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">客服号总览</h2>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/agent"
            className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            <Download className="w-4 h-4" /> 下载客户机
          </Link>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        公司每个客服号一行。点一行进该号工作台：配人设/知识库/运营参数、看客户与成效。
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
        </div>
      ) : machines.length === 0 ? (
        <div data-testid="cs-overview-empty" className="py-14 text-center text-sm text-gray-500 dark:text-gray-400">
          还没有客服号。请在客户 PC 上装好 Agent（自动报到）后，到该机器工作台「运营设置」完成绑定。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">客服号</th>
                <th className="text-left font-medium px-4 py-2.5">在线</th>
                <th className="text-left font-medium px-4 py-2.5">微信健康</th>
                <th className="text-left font-medium px-4 py-2.5">今日接待</th>
                <th className="text-left font-medium px-4 py-2.5">模式</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => {
                const health = wechatHealth(m);
                const served = m.wechat_id ? servedByWid[m.wechat_id] ?? 0 : 0;
                return (
                  <tr
                    key={m.machine_id}
                    data-testid="cs-overview-row"
                    data-machine-id={m.machine_id}
                    onClick={() => navigate(`/wechat/account/${encodeURIComponent(m.machine_id)}`)}
                    className="border-t border-slate-100 dark:border-slate-700/60 hover:bg-sky-50 dark:hover:bg-sky-900/20 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-white">
                        {m.self_name || m.hostname || m.machine_id.slice(0, 8) + '…'}
                      </div>
                      <div className="text-xs text-gray-400">
                        {m.real_wechat_id || m.wechat_id || (m.configured ? '' : '待绑定')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={m.online ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                        {m.online ? '● 在线' : '○ 离线'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={health.ok ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                        {health.text}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{served}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          m.auto_agent_enabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}
                      >
                        {m.auto_agent_enabled ? '真发' : '演练'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
