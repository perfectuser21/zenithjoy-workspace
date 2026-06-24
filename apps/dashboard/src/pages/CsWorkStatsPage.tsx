/**
 * CsWorkStatsPage — 微信客服「客服工作汇总」(S3，挂 Line04 私域客服区)
 *
 * 管理员一眼看到每台客服机今天/昨天干了多少活：接收 / 回复 / 接待客人数 / 工作时长 4 个数，
 * 以及这台现在是真发还是演练。顶部切「今天 / 昨天」换两天的数。
 * 1 账户 = 1 机器 = 1 微信号 → 每客服微信号一张卡，各看各的，互不串台。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, MessageSquare, Reply, Users, Clock } from 'lucide-react';
import { wechatCsStatsApi, type CsWorkStat, type StatsDate } from '../api/wechat-cs-stats.api';

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
  const [date, setDate] = useState<StatsDate>('today');
  const [stats, setStats] = useState<CsWorkStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: StatsDate) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await wechatCsStatsApi.getStats(d);
      setStats(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const Tab = ({ value, label }: { value: StatsDate; label: string }) => (
    <button
      data-testid={`cs-stats-tab-${value}`}
      onClick={() => setDate(value)}
      className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
        date === value
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
          onClick={() => load(date)}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        每台客服机{date === 'today' ? '今天' : '昨天'}的接收 / 回复 / 接待客人数 / 工作时长。
      </p>

      <div className="flex gap-2 mb-5">
        <Tab value="today" label="今天" />
        <Tab value="yesterday" label="昨天" />
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

      {!loading && !error && stats.length === 0 && (
        <div data-testid="cs-stats-empty" className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
          {date === 'today' ? '今天' : '昨天'}还没有任何客服机产生消息。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stats.map((s) => {
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
                  {s.online !== undefined && (
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        s.online ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                      title={s.online ? '在线' : '离线'}
                    />
                  )}
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
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <StatCell testid="stat-received" Icon={MessageSquare} label="接收" unit="条" value={s.received_count} />
                <StatCell testid="stat-reply" Icon={Reply} label="回复" unit="条" value={s.reply_count} />
                <StatCell testid="stat-served" Icon={Users} label="接待" unit="人" value={s.served_customers} />
                <StatCell testid="stat-duration" Icon={Clock} label="工作时长" unit="分" value={s.work_duration_minutes} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
