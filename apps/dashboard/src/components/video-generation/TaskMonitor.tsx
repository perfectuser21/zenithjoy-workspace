/**
 * 任务监控组件
 */

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';
import type { VideoGenerationTask } from '../../types/video-generation.types';
import { pollTaskStatus } from '../../api/video-generation.api';

interface TaskMonitorProps {
  taskId: string;
  onComplete: (task: VideoGenerationTask) => void;
  onError: (error: Error) => void;
}

export default function TaskMonitor({ taskId, onComplete, onError }: TaskMonitorProps) {
  const [task, setTask] = useState<VideoGenerationTask | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    // 轮询任务状态
    pollTaskStatus(
      taskId,
      (updatedTask) => {
        setTask(updatedTask);
      },
      3000, // 每 3 秒轮询一次
      300000 // 5 分钟超时
    )
      .then(onComplete)
      .catch(onError);

    // 计时器
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [taskId, onComplete, onError]);

  if (!task) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const statusConfig = {
    queued: {
      icon: Clock,
      color: 'text-slate-500',
      bgColor: 'bg-slate-100 dark:bg-slate-800',
      label: '排队中'
    },
    in_progress: {
      icon: Loader2,
      color: 'text-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
      label: '生成中'
    },
    completed: {
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
      label: '已完成'
    },
    failed: {
      icon: XCircle,
      color: 'text-red-500',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
      label: '失败'
    }
  };

  const config = statusConfig[task.status] || {
    // 兜底配置：当状态未知时显示加载状态
    icon: Loader2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    label: '加载中'
  };

  if (!statusConfig[task.status]) {
    console.warn('Unknown task status, using fallback:', task.status);
  }

  const Icon = config.icon;

  return (
    <div className={`rounded-2xl border border-slate-200 dark:border-slate-700 p-6 ${config.bgColor}`}>
      {/* 状态标题 */}
      <div className="flex items-center gap-3 mb-4">
        <Icon
          className={`w-6 h-6 ${config.color} ${task.status === 'in_progress' ? 'animate-spin' : ''}`}
        />
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {config.label}
          </h3>
          <div className="text-sm text-slate-500 dark:text-slate-400">
            任务 ID: {taskId.slice(0, 8)}...
          </div>
        </div>
      </div>

      {/* 进度条 */}
      {task.status === 'in_progress' && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400 mb-2">
            <span>生成进度</span>
            <span className="font-medium">{task.progress}%</span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${task.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 错误信息 */}
      {task.status === 'failed' && task.error && (
        <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl">
          <div className="text-sm text-red-700 dark:text-red-400 font-medium mb-1">
            错误信息
          </div>
          <div className="text-sm text-red-600 dark:text-red-300">
            {task.error.message}
          </div>
        </div>
      )}

      {/* 统计信息 */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">耗时</div>
          <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">
            {formatTime(elapsedTime)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">创建时间</div>
          <div className="text-sm font-medium text-slate-900 dark:text-white mt-1">
            {formatDateTime(task.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}

// 格式化时间（秒 → MM:SS）
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 格式化日期时间
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
