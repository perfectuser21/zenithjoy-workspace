/**
 * CsWorkStatsPage — 微信客服「客服工作汇总」(整合后；挂 Line04 私域客服区)
 *
 * 管理员一眼看到每台客服机干了多少活：接收 / 回复 / 接待客人数 / 工作时长 4 个数 + 真发/演练。
 * 顶部三个 Tab：
 *   今天 / 昨天 —— 实时统计（GET /wechat/cs/stats?date=today|yesterday）
 *   历史      —— 回看任意历史日期的结算日报（GET /wechat/cs/daily-report?date=YYYY-MM-DD，含一句话小结）
 * 「客服日报」(旧 S4)已并进这里的「历史」Tab，旧路由 /wechat/cs-daily-report 重定向到本页。
 * 1 账户 = 1 机器 = 1 微信号 → 每客服微信号一张卡，各看各的，互不串台。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, MessageSquare, Reply, Users, Clock } from 'lucide-react';
import { wechatCsStatsApi, type CsWorkStat, type StatsDate } from '../api/wechat-cs-stats.api';
import { wechatCsDailyReportApi, type CsDailyReport } from '../api/wechat-cs-daily-report.api';

// Tab 取值：实时两天 + 历史日期
type TabKey = StatsDate | 'history';

function todayBeijing(): string {
  // YYYY-MM-DD（北京时区），en-CA 直接给 ISO 日期格式
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

// 统一的卡片数据形状（实时 stat 与历史 report 都收敛到这里渲染）
interface UnifiedRow {
  cs_wechat_id: string;
  self_name?: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
  auto_agent_enabled?: boolean;
  online?: boolean;
  summary_text?: string; // 仅历史日报有
}

function statToRow(s: CsWorkStat): UnifiedRow {
  return {
    cs_wechat_id: s.cs_wechat_id,
    self_name: s.self_name,
    received_count: s.received_count,
    reply_count: s.reply_count,
    served_customers: s.served_customers,
    work_duration_minutes: s.work_duration_minutes,
    auto_agent_enabled: s.auto_agent_enabled,
    online: s.online,
  };
}

function reportToRow(r: CsDailyReport): UnifiedRow {
  return {
    cs_wechat_id: r.cs_wechat_id,
    self_name: r.self_name,
    received_count: r.received_count,
    reply_count: r.reply_count,
    served_customers: r.served_customers,
    work_duration_minutes: r.work_duration_minutes,
    summary_text: r.summary_text,
  };
}

function StatCell({
  testid,
  Icon,
  label,
  value,
  unit,
}: {
  testid: string;
  Icon: typeof MessageSquare;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-3 rounded-md bg-slate-50 dark:bg-slate-700/40">
      <Icon className="w-4 h-4 mb-1 text-slate-400" />
      <span data-testid={testid} className="text-2xl font-semibold text-gray-900 dark:text-white">
        {value}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {label}（{unit}）
      </span>
    </div>
  );
}

export default function CsWorkStatsPage() {
  const [tab, setTab] = useState<TabKey>('today');
  const [historyDate, setHistoryDate] = useState<string>(todayBeijing());
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 实时统计（今天/昨天）
  const loadLive = useCallback(async (d: StatsDate) => {
    setLoading(true);
    setError(null);
    try {
      const data = await wechatCsStatsApi.getStats(d);
      setRows(data.map(statToRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 历史日报（任意日期）
  const loadHistory = useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await wechatCsDailyReportApi.getReports(date);
      setRows(data.map(reportToRow));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 切「今天/昨天」立即拉；切到「历史」用当前选的日期拉
  useEffect(() => {
    if (tab === 'history') {
      void loadHistory(historyDate);
    } else {
      void loadLive(tab);
    }
    // historyDate 改了不自动重拉（由「查看」按钮显式触发），避免边打字边请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadLive, loadHistory]);

  const refresh = useCallback(() => {
    if (tab === 'history') void loadHistory(historyDate);
    else void loadLive(tab);
  }, [tab, historyDate, loadLive, loadHistory]);

  const isHistory = tab === 'history';

  const Tab = ({ value, label }: { value: TabKey; label: string }) => (
    <button
      data-testid={`cs-stats-tab-${value}`}
      onClick={() => setTab(value)}
      className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
        tab === value
          ? 'bg-blue-600 text-white'
          : 'bg-slate-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">客服工作汇总</h2>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        每台客服机的接收 / 回复 / 接待客人数 / 工作时长。今天/昨天看实时，历史看任意一天的结算日报（含小结）。
      </p>

      <div className="flex gap-2 mb-5 flex-wrap items-center">
        <Tab value="today" label="今天" />
        <Tab value="yesterday" label="昨天" />
        <Tab value="history" label="历史" />
        {isHistory && (
          <div className="flex items-center gap-2 ml-1">
            <input
              data-testid="cs-stats-date-input"
              type="date"
              value={historyDate}
              onChange={(e) => setHistoryDate(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
            />
            <button
              data-testid="cs-stats-history-load-btn"
              onClick={() => void loadHistory(historyDate)}
              className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              查看
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
        </div>
      )}

      {error && !loading && (
        <div data-testid="cs-stats-error" className="text-sm text-red-500 py-6">
          加载失败：{error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div data-testid="cs-stats-empty" className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
          {isHistory
            ? `${historyDate} 还没有日报（当天可能未到结算时间或无任何客服消息）。`
            : `${tab === 'today' ? '今天' : '昨天'}还没有任何客服机产生消息。`}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((s) => {
          const isReal = s.auto_agent_enabled === true;
          return (
            <div
              key={s.cs_wechat_id}
              data-testid={`cs-stat-card-${s.cs_wechat_id}`}
              className="bg-white dark:bg-slate-800 rounded-lg shadow p-5 border border-slate-200 dark:border-slate-700"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {s.self_name || '未命名客服'}
                  </div>
                  <div className="text-xs text-gray-400">{s.cs_wechat_id}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!isHistory && s.online !== undefined && (
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        s.online ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                      title={s.online ? '在线' : '离线'}
                    />
                  )}
                  {!isHistory && (
                    <span
                      data-testid="stat-mode"
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        isReal
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      }`}
                    >
                      {isReal ? '真发' : '演练'}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <StatCell testid="stat-received" Icon={MessageSquare} label="接收" unit="条" value={s.received_count} />
                <StatCell testid="stat-reply" Icon={Reply} label="回复" unit="条" value={s.reply_count} />
                <StatCell testid="stat-served" Icon={Users} label="接待" unit="人" value={s.served_customers} />
                <StatCell testid="stat-duration" Icon={Clock} label="工作时长" unit="分" value={s.work_duration_minutes} />
              </div>
              {isHistory && s.summary_text && (
                <p data-testid="stat-summary" className="text-sm text-gray-600 dark:text-gray-300 mt-3">
                  {s.summary_text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
