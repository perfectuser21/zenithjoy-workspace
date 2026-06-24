/**
 * CsDailyReportPage — 微信客服「客服日报」(S4，挂 Line04 私域客服区)
 *
 * 回看任意历史日期的每客服工作日报：接收 / 回复 / 接待客人数 / 工作时长 4 个数 + 一句话小结。
 * 与「客服工作汇总」(S3)区别：S3 是实时今天/昨天；S4 是每天 23:55 结算冻结的历史日报，可翻任意一天。
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, Reply, Users, Clock } from 'lucide-react';
import { wechatCsDailyReportApi, type CsDailyReport } from '../api/wechat-cs-daily-report.api';

function todayBeijing(): string {
  // YYYY-MM-DD（北京时区），en-CA 直接给 ISO 日期格式
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function Cell({
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

export default function CsDailyReportPage() {
  const [date, setDate] = useState<string>(todayBeijing());
  const [reports, setReports] = useState<CsDailyReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await wechatCsDailyReportApi.getReports(d);
      setReports(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
    // 仅首挂载拉一次当天；之后由「查看」按钮显式触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">客服日报</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        选一个历史日期，看那天每台客服机的接收 / 回复 / 接待客人数 / 工作时长 + 小结。
      </p>

      <div className="flex items-center gap-2 mb-5">
        <input
          data-testid="cs-report-date-input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
        />
        <button
          data-testid="cs-report-load-btn"
          onClick={() => load(date)}
          className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          查看
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-500 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> 加载中…
        </div>
      )}

      {error && !loading && (
        <div data-testid="cs-report-error" className="text-sm text-red-500 py-6">
          加载失败：{error}
        </div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div data-testid="cs-report-empty" className="text-sm text-gray-500 dark:text-gray-400 py-10 text-center">
          {date} 还没有日报（当天可能未到结算时间或无任何客服消息）。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reports.map((r) => (
          <div
            key={r.cs_wechat_id}
            data-testid={`cs-report-card-${r.cs_wechat_id}`}
            className="bg-white dark:bg-slate-800 rounded-lg shadow p-5 border border-slate-200 dark:border-slate-700"
          >
            <div className="mb-4">
              <div className="font-medium text-gray-900 dark:text-white">
                {r.self_name || '未命名客服'}
              </div>
              <div className="text-xs text-gray-400">
                {r.cs_wechat_id} · {r.report_date}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 mb-3">
              <Cell testid="report-received" Icon={MessageSquare} label="接收" unit="条" value={r.received_count} />
              <Cell testid="report-reply" Icon={Reply} label="回复" unit="条" value={r.reply_count} />
              <Cell testid="report-served" Icon={Users} label="接待" unit="人" value={r.served_customers} />
              <Cell testid="report-duration" Icon={Clock} label="工作时长" unit="分" value={r.work_duration_minutes} />
            </div>
            <p data-testid="report-summary" className="text-sm text-gray-600 dark:text-gray-300">
              {r.summary_text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
