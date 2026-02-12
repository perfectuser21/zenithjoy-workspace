/**
 * 视频预览组件
 */

import { Download } from 'lucide-react';
import type { VideoGenerationTask } from '../../types/video-generation.types';

interface VideoPreviewProps {
  task: VideoGenerationTask;
  onReset: () => void;
}

export default function VideoPreview({ task, onReset }: VideoPreviewProps) {
  if (!task.result) {
    return null;
  }

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = task.result!.video_url;
    a.download = `video-${task.id}.mp4`;
    a.click();
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
      {/* 视频播放器 */}
      <div className="relative bg-black aspect-video">
        <video
          src={task.result.video_url}
          controls
          className="w-full h-full"
          poster={task.result.thumbnail_url}
        />
        <div className="absolute top-4 left-4 flex gap-2">
          <span className="px-3 py-1 bg-black/60 backdrop-blur-sm text-white text-xs rounded-lg">
            {task.result.resolution}
          </span>
          <span className="px-3 py-1 bg-black/60 backdrop-blur-sm text-white text-xs rounded-lg">
            {task.result.duration}s
          </span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-6">
        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium transition-colors"
          >
            <Download className="w-5 h-5" />
            下载视频
          </button>
          <button
            onClick={onReset}
            className="flex-1 px-4 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-medium transition-colors"
          >
            生成新视频
          </button>
        </div>

        {/* 元信息 */}
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-slate-500 dark:text-slate-400">任务 ID</div>
              <div className="text-slate-900 dark:text-white font-medium mt-1 truncate">
                {task.id.slice(0, 12)}...
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">完成时间</div>
              <div className="text-slate-900 dark:text-white font-medium mt-1">
                {task.completed_at
                  ? new Date(task.completed_at * 1000).toLocaleString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500 dark:text-slate-400">耗时</div>
              <div className="text-slate-900 dark:text-white font-medium mt-1">
                {task.completed_at && task.created_at
                  ? `${Math.floor((task.completed_at - task.created_at) / 60)}m ${(task.completed_at - task.created_at) % 60}s`
                  : '-'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
