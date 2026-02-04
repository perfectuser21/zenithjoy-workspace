import { useState, useEffect } from 'react';
import {
  Database,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import type { ScrapingTask } from '../api/scraping.api';
import { fetchScrapingTasks, triggerScrapingTask } from '../api/scraping.api';

// 平台图标映射
const PLATFORM_ICONS: Record<string, { color: string; bgColor: string }> = {
  xiaohongshu: { color: 'text-red-600', bgColor: 'bg-red-50 dark:bg-red-900/30' },
  douyin: { color: 'text-black dark:text-white', bgColor: 'bg-gray-100 dark:bg-gray-800' },
  weibo: { color: 'text-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-900/30' },
  bilibili: { color: 'text-pink-500', bgColor: 'bg-pink-50 dark:bg-pink-900/30' },
};

// 状态配置
const STATUS_CONFIG = {
  idle: { label: '空闲', icon: Clock, color: 'text-gray-500', bgColor: 'bg-gray-100 dark:bg-gray-700' },
  running: { label: '运行中', icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  success: { label: '成功', icon: CheckCircle2, color: 'text-green-500', bgColor: 'bg-green-100 dark:bg-green-900/30' },
  error: { label: '失败', icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-100 dark:bg-red-900/30' },
};

// 格式化时间
function formatTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 任务卡片组件
function TaskCard({
  task,
  onTrigger,
  triggering,
}: {
  task: ScrapingTask;
  onTrigger: () => void;
  triggering: boolean;
}) {
  const platformStyle = PLATFORM_ICONS[task.platform] || PLATFORM_ICONS.xiaohongshu;
  const statusConfig = STATUS_CONFIG[task.status];
  const StatusIcon = statusConfig.icon;
  const isRunning = task.status === 'running' || triggering;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 hover:shadow-lg transition-shadow">
      {/* 头部 */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-xl ${platformStyle.bgColor} flex items-center justify-center`}>
            <Database className={`w-6 h-6 ${platformStyle.color}`} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-white">{task.name}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{task.description}</p>
          </div>
        </div>

        {/* 状态标签 */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
          <StatusIcon className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          {statusConfig.label}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-4 mb-4 py-3 border-y border-slate-100 dark:border-slate-700">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">最后执行</p>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {formatTime(task.lastExecutedAt)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">执行次数</p>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {task.stats.totalRuns} 次
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">采集数据</p>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {task.stats.dataCollected.toLocaleString()} 条
          </p>
        </div>
      </div>

      {/* 最近结果 */}
      {task.lastResult && (
        <div className="mb-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">最近结果</p>
          {task.lastResult.success ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              成功采集 {task.lastResult.dataCount || 0} 条数据
            </p>
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400">
              {task.lastResult.error || '执行失败'}
            </p>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <button
        onClick={onTrigger}
        disabled={isRunning}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
          isRunning
            ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-white'
        }`}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            执行中...
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            立即执行
          </>
        )}
      </button>
    </div>
  );
}

export default function ScrapingPage() {
  const [tasks, setTasks] = useState<ScrapingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [triggeringTasks, setTriggeringTasks] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchScrapingTasks();
      setTasks(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError('加载数据失败，请稍后重试');
      console.error('Failed to load scraping tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleTrigger = async (taskId: string) => {
    setTriggeringTasks((prev) => new Set(prev).add(taskId));

    try {
      const result = await triggerScrapingTask(taskId);
      if (result.success) {
        // 刷新任务列表获取最新状态
        await loadData();
      } else {
        setError(result.error || '触发任务失败');
      }
    } catch (err) {
      setError('触发任务失败，请稍后重试');
      console.error('Failed to trigger task:', err);
    } finally {
      setTriggeringTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const totalTasks = tasks.length;
  const runningTasks = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              数据采集
            </h1>
            <p className="text-slate-500 dark:text-slate-400 ml-13">
              管理爬虫任务 · {totalTasks} 个任务
              {runningTasks > 0 && ` · ${runningTasks} 个运行中`}
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {lastRefresh && (
          <p className="text-xs text-slate-400 dark:text-slate-500 ml-13">
            最后更新: {lastRefresh.toLocaleTimeString('zh-CN')}
          </p>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 加载状态 */}
      {loading && tasks.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
            <p className="text-slate-500 dark:text-slate-400">加载中...</p>
          </div>
        </div>
      )}

      {/* 任务卡片网格 */}
      {(!loading || tasks.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onTrigger={() => handleTrigger(task.id)}
              triggering={triggeringTasks.has(task.id)}
            />
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && tasks.length === 0 && (
        <div className="text-center py-12">
          <Database className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">暂无采集任务</h3>
          <p className="text-gray-500 dark:text-gray-400">配置 N8N 工作流后即可在此管理</p>
        </div>
      )}
    </div>
  );
}
