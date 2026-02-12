/**
 * 视频预览组件（多平台支持）
 */

import { Download } from 'lucide-react';
import type { UnifiedTask } from '../../api/platforms';

interface VideoPreviewProps {
  task: UnifiedTask;
  onReset: () => void;
}

export default function VideoPreview({ task, onReset }: VideoPreviewProps) {
  if (!task.videoUrl) {
    return null;
  }

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = task.videoUrl!;
    a.download = `video-${task.id}.mp4`;
    a.click();
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
      {/* 视频播放器 */}
      <div className="relative bg-black aspect-video">
        <video
          src={task.videoUrl}
          controls
          className="w-full h-full"
        />
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
              <div className="text-slate-500 dark:text-slate-400">平台</div>
              <div className="text-slate-900 dark:text-white font-medium mt-1">
                {task.platform.toUpperCase()}
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
          </div>
        </div>

        {/* 提示 */}
        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            ⚠️ 视频链接有效期为 24 小时，请及时下载保存
          </p>
        </div>
      </div>
    </div>
  );
}
