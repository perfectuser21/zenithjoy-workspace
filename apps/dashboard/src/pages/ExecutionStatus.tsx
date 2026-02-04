import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, RefreshCw, TrendingUp, Clock, Zap } from 'lucide-react';

interface TodayStats {
  running: number;
  success: number;
  error: number;
  total: number;
  successRate: number;
}

interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string;
  stoppedAt?: string;
  duration?: number;
}

interface ApiResponse {
  todayStats: TodayStats;
  recentCompleted: Execution[];
  runningExecutions: Execution[];
}

const FEATURES = [
  { id: 'data-collection', name: '数据采集', color: '#3b82f6', bg: 'bg-blue-50 dark:bg-blue-900/20', keywords: ['采集', 'scrape', 'collect', 'fetch-data'] },
  { id: 'content-publish', name: '内容发布', color: '#8b5cf6', bg: 'bg-purple-50 dark:bg-purple-900/20', keywords: ['发布', 'publish', 'post'] },
  { id: 'ai-factory', name: 'AI 自动化', color: '#f59e0b', bg: 'bg-amber-50 dark:bg-amber-900/20', keywords: ['dispatcher', 'claude', 'executor', 'ai'] },
  { id: 'monitoring', name: '监控巡检', color: '#10b981', bg: 'bg-emerald-50 dark:bg-emerald-900/20', keywords: ['监控', 'monitor', 'patrol'] },
  { id: 'maintenance', name: '系统维护', color: '#6b7280', bg: 'bg-gray-50 dark:bg-gray-800/50', keywords: ['nightly', 'backup', 'cleanup', 'scheduler'] },
];

function matchFeature(name: string) {
  const lower = (name || '').toLowerCase();
  for (const f of FEATURES) {
    if (f.keywords.some(k => lower.includes(k))) return f;
  }
  return FEATURES[4];
}

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds?: number) {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function ExecutionStatus() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/n8n-live-status/instances/local/overview');
      if (!res.ok) throw new Error('API error');
      const json = await res.json();
      setData(json);
      setError('');
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, []);

  // 合并所有执行记录
  const allExecs = [...(data?.runningExecutions || []), ...(data?.recentCompleted || [])];

  // 按 Feature 统计
  const featureStats = FEATURES.map(f => {
    const matched = allExecs.filter(e => matchFeature(e.workflowName).id === f.id);
    const success = matched.filter(e => e.status === 'success').length;
    const failed = matched.filter(e => e.status === 'error' || e.status === 'crashed').length;
    const running = matched.filter(e => e.status === 'running').length;
    const avgDuration = matched.length > 0
      ? Math.round(matched.reduce((acc, e) => acc + (e.duration || 0), 0) / matched.length)
      : 0;

    return {
      ...f,
      total: matched.length,
      success,
      failed,
      running,
      avgDuration,
      executions: matched.slice(0, 5), // 最近5条
    };
  }).filter(s => s.total > 0);

  const todayStats = data?.todayStats || { total: 0, success: 0, error: 0, running: 0, successRate: 0 };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        <XCircle className="w-5 h-5 mr-2" />{error}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">工作记录</h1>
          <p className="text-sm text-gray-500 mt-1">今日自动化任务执行概览</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{lastUpdate} 更新</span>
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 顶部统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <Zap className="w-3.5 h-3.5" />
            <span>总执行</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{todayStats.total}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-green-600 text-xs mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>成功</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{todayStats.success}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-red-500 text-xs mb-2">
            <XCircle className="w-3.5 h-3.5" />
            <span>失败</span>
          </div>
          <div className="text-2xl font-bold text-red-500">{todayStats.error}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 text-xs mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>成功率</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{todayStats.successRate}%</div>
        </div>
      </div>

      {/* Feature 分组 */}
      <div className="space-y-4">
        {featureStats.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center text-gray-400 border border-gray-100 dark:border-gray-700">
            今日暂无执行记录
          </div>
        ) : (
          featureStats.map(feat => {
            const rate = feat.total > 0 ? Math.round((feat.success / feat.total) * 100) : 0;

            return (
              <div
                key={feat.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden"
              >
                {/* Feature 头部 */}
                <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50 dark:border-gray-700/50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: feat.color + '15' }}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: feat.color }}
                      />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{feat.name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-3 mt-0.5">
                        <span>{feat.total} 次执行</span>
                        {feat.avgDuration > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            平均 {formatDuration(feat.avgDuration)}
                          </span>
                        )}
                        {feat.running > 0 && (
                          <span className="text-blue-500 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {feat.running} 运行中
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 右侧进度 */}
                  <div className="flex items-center gap-4">
                    <div className="w-32">
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${rate}%`, backgroundColor: feat.color }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm font-medium" style={{ color: feat.color }}>
                      {rate}%
                    </div>
                    <div className="flex items-center gap-1.5 text-xs w-20 justify-end">
                      <span className="text-green-600 font-medium">{feat.success}</span>
                      <span className="text-gray-300">/</span>
                      <span className={feat.failed > 0 ? 'text-red-500 font-medium' : 'text-gray-400'}>
                        {feat.failed}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 最近执行列表 */}
                {feat.executions.length > 0 && (
                  <div className="px-5 py-3 bg-gray-50/50 dark:bg-gray-900/30">
                    <div className="flex flex-wrap gap-2">
                      {feat.executions.map(exec => (
                        <div
                          key={exec.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs ${
                            exec.status === 'success'
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                              : exec.status === 'running'
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {exec.status === 'success' && <CheckCircle2 className="w-3 h-3" />}
                          {exec.status === 'running' && <Loader2 className="w-3 h-3 animate-spin" />}
                          {(exec.status === 'error' || exec.status === 'crashed') && <XCircle className="w-3 h-3" />}
                          <span>{formatTime(exec.startedAt)}</span>
                          {exec.duration && <span className="text-gray-500">· {formatDuration(exec.duration)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
