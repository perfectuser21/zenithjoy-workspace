import { useState, useEffect, useRef } from 'react';
import {
  Target,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Users,
  ChevronRight,
} from 'lucide-react';
import {
  startCompetitorResearch,
  getJobStatus,
  getJobResults,
} from '../api/competitor-research.api';
import type { AccountRecord, JobStatus, JobResultsData } from '../api/competitor-research.api';

// ─── 格式化粉丝数 ─────────────────────────────────────────────────
function formatFollowers(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

// ─── 状态图标 ─────────────────────────────────────────────────────
const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; color: string; bgColor: string; Icon: typeof Clock }
> = {
  pending: {
    label: '等待中',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100 dark:bg-gray-700',
    Icon: Clock,
  },
  running: {
    label: '采集中',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    Icon: Loader2,
  },
  completed: {
    label: '已完成',
    color: 'text-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    Icon: CheckCircle2,
  },
  failed: {
    label: '失败',
    color: 'text-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    Icon: XCircle,
  },
};

// ─── 账号表格行 ───────────────────────────────────────────────────
function AccountRow({
  account,
  index,
}: {
  account: AccountRecord;
  index: number;
}) {
  const bio = account.bio
    ? account.bio.length > 60
      ? account.bio.slice(0, 60) + '…'
      : account.bio
    : '—';

  return (
    <tr className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">
        {index + 1}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-slate-800 dark:text-white text-sm">
          {account.creatorName || '—'}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          R{account.round} · {account.keyword}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300 font-mono">
        {account.douyinId || '—'}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
        {account.followers > 0 ? formatFollowers(account.followers) : '—'}
      </td>
      <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400 max-w-xs">
        {bio}
      </td>
      <td className="px-4 py-3">
        {account.profileUrl ? (
          <a
            href={account.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600 text-sm transition-colors"
          >
            主页
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-slate-400 text-sm">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── 账号表格 ─────────────────────────────────────────────────────
function AccountTable({
  accounts,
  emptyText,
}: {
  accounts: AccountRecord[];
  emptyText: string;
}) {
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-slate-500">
        <Users className="w-10 h-10 mb-3" />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-700/50">
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 w-10">
              #
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              账号名
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              抖音号
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              粉丝数
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              简介
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              主页
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc, i) => (
            <AccountRow key={`${acc.profileUrl}-${i}`} account={acc} index={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────
type TabKey = 'primary' | 'secondary' | 'final';

export default function CompetitorResearchPage() {
  const [topic, setTopic] = useState('一人公司');
  const [roundLimit, setRoundLimit] = useState(20);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<JobResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('primary');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 日志自动滚动到底部
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // 轮询任务状态
  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus === 'completed' || jobStatus === 'failed') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    pollingRef.current = setInterval(async () => {
      try {
        const statusData = await getJobStatus(jobId);
        setJobStatus(statusData.status);
        setLogs(statusData.logs);
        setProgress(statusData.progress ?? 0);

        if (statusData.status === 'completed') {
          // 拉取结果
          try {
            const data = await getJobResults(jobId);
            setResults(data);
          } catch (e) {
            setError(`获取结果失败：${(e as Error).message}`);
          }
        } else if (statusData.status === 'failed') {
          setError(statusData.error || '采集失败');
        }
      } catch (e) {
        console.error('轮询状态失败', e);
      }
    }, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobId, jobStatus]);

  const handleStart = async () => {
    if (!topic.trim()) return;
    setError(null);
    setLogs([]);
    setResults(null);
    setProgress(0);
    setJobId(null);
    setJobStatus(null);

    try {
      const { jobId: id } = await startCompetitorResearch({ topic: topic.trim(), roundLimit });
      setJobId(id);
      setJobStatus('pending');
    } catch (e) {
      setError(`启动失败：${(e as Error).message}`);
    }
  };

  const isRunning = jobStatus === 'pending' || jobStatus === 'running';
  const statusCfg = jobStatus ? STATUS_CONFIG[jobStatus] : null;
  const StatusIcon = statusCfg?.Icon;

  const tabConfig: { key: TabKey; label: string; count: number }[] = [
    {
      key: 'primary',
      label: '初筛',
      count: results?.primaryScreening.length ?? 0,
    },
    {
      key: 'secondary',
      label: '二筛',
      count: results?.secondaryScreening.length ?? 0,
    },
    {
      key: 'final',
      label: '最终池',
      count: results?.finalPool.length ?? 0,
    },
  ];

  const currentAccounts =
    results
      ? activeTab === 'primary'
        ? results.primaryScreening
        : activeTab === 'secondary'
          ? results.secondaryScreening
          : results.finalPool
      : [];

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
            <Target className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          智能对标
        </h1>
        <p className="text-slate-500 dark:text-slate-400 ml-13">
          自动搜索并筛选抖音对标账号 · 基于关键词多轮采集
        </p>
      </div>

      {/* 参数面板 */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-4">
          采集参数
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              目标领域 Topic
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isRunning}
              placeholder="例：一人公司"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              每轮账号上限
            </label>
            <input
              type="number"
              value={roundLimit}
              onChange={(e) => setRoundLimit(Number(e.target.value))}
              disabled={isRunning}
              min={5}
              max={100}
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={handleStart}
            disabled={isRunning || !topic.trim()}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors ${
              isRunning || !topic.trim()
                ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                : 'bg-indigo-500 hover:bg-indigo-600 text-white'
            }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                采集中...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                开始采集
              </>
            )}
          </button>

          {/* 状态徽章 */}
          {statusCfg && StatusIcon && (
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusCfg.bgColor} ${statusCfg.color}`}
            >
              <StatusIcon
                className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`}
              />
              {statusCfg.label}
              {jobStatus === 'running' && progress > 0 && ` · ${progress}%`}
            </div>
          )}
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 进度日志 */}
      {logs.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 mb-6 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              采集日志
            </span>
            {isRunning && (
              <span className="text-xs text-blue-500 animate-pulse">实时更新中...</span>
            )}
          </div>
          <div className="bg-slate-900 dark:bg-slate-950 p-4 h-48 overflow-y-auto font-mono text-xs text-slate-300">
            {logs.map((line, i) => (
              <div key={i} className="mb-0.5 leading-5">
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>

          {/* 进度条 */}
          {jobStatus === 'running' && (
            <div className="px-5 py-2">
              <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 结果区域 */}
      {results && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* 报告摘要 */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-indigo-50 dark:bg-indigo-900/20">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-0.5">初筛</p>
                <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">
                  {results.report.primaryCount}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-indigo-300 self-center" />
              <div>
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-0.5">二筛</p>
                <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">
                  {results.report.secondaryCount}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-indigo-300 self-center" />
              <div>
                <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-0.5">最终池</p>
                <p className="text-2xl font-bold text-indigo-700 dark:text-indigo-300">
                  {results.report.finalCount}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-xs text-slate-400 mb-0.5">采集时间</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {new Date(results.report.executedAt).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div className="flex border-b border-slate-100 dark:border-slate-700">
            {tabConfig.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
                <span className="ml-1.5 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded text-xs">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* 账号表格 */}
          <AccountTable
            accounts={currentAccounts}
            emptyText={
              activeTab === 'primary'
                ? '暂无初筛数据'
                : activeTab === 'secondary'
                  ? '无符合二筛条件的账号'
                  : '最终池为空'
            }
          />
        </div>
      )}
    </div>
  );
}
