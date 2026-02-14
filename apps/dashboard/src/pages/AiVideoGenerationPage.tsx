/**
 * AI 视频生成页面
 *
 * 功能：
 * - 选择 AI 模型
 * - 上传首帧/尾帧图片
 * - 配置参数（时长、分辨率、开关选项）
 * - 输入提示词
 * - 提交生成请求
 * - 监控任务状态
 * - 预览和下载视频
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, AlertCircle, Loader2, History } from 'lucide-react';
import ModelSelector, { MODEL_CONFIGS } from '../components/video-generation/ModelSelector';
import ImageUploader from '../components/video-generation/ImageUploader';
import TaskMonitor from '../components/video-generation/TaskMonitor';
import VideoPreview from '../components/video-generation/VideoPreview';
import type { VideoModel, VideoDuration, VideoResolution, AspectRatio, UnifiedTask } from '../types/video-generation.types';
import { createVideoGeneration } from '../api/video-generation.api';
import { aiVideoApi } from '../api/ai-video.api';

type PageState = 'input' | 'generating' | 'completed' | 'error';

export default function AiVideoGenerationPage() {
  const navigate = useNavigate();

  // 模型和参数
  const [model, setModel] = useState<VideoModel>('veo3.1-fast');
  const [prompt, setPrompt] = useState('');
  const [duration] = useState<VideoDuration>(8); // ToAPI 固定 8 秒
  const [resolution, setResolution] = useState<VideoResolution>('1080p');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [fastPretreatment, setFastPretreatment] = useState(false);
  const [watermark, setWatermark] = useState(false);

  // 图片
  const [firstFrameImage, setFirstFrameImage] = useState<string | null>(null);
  const [lastFrameImage, setLastFrameImage] = useState<string | null>(null);

  // 任务状态
  const [pageState, setPageState] = useState<PageState>('input');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [completedTask, setCompletedTask] = useState<UnifiedTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 获取当前模型配置
  const modelConfig = MODEL_CONFIGS.find(m => m.id === model);

  // 恢复进行中的任务（页面加载时）
  useEffect(() => {
    const restoreActiveTask = async () => {
      try {
        // 1. 从 localStorage 读取最后的 taskId（兜底）
        const lastTaskId = localStorage.getItem('last_video_task_id');

        if (lastTaskId) {
          // 2. 调用 API 查询该任务状态
          const task = await aiVideoApi.getGenerationById(lastTaskId);

          if (task && (task.status === 'in_progress' || task.status === 'queued')) {
            // 恢复任务状态
            setTaskId(task.id);
            setPageState('generating');
            setPrompt(task.prompt);
            console.log('恢复进行中的任务:', task.id);
          }
        }
      } catch (error) {
        console.error('恢复任务失败:', error);
        // 失败不影响正常使用
      }
    };

    restoreActiveTask();
  }, []);

  // 提交生成请求
  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return;
    }

    setError(null);
    setPageState('generating');

    try {
      const imageUrls: string[] = [];
      if (firstFrameImage) imageUrls.push(firstFrameImage);
      if (lastFrameImage) imageUrls.push(lastFrameImage);

      const response = await createVideoGeneration({
        platform: 'toapi',
        model,
        prompt: prompt.trim(),
        duration,
        aspectRatio,
        resolution,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        metadata: {
          prompt_optimizer: promptOptimizer,
          fast_pretreatment: fastPretreatment,
          watermark,
        },
      });

      setTaskId(response.id);

      // 保存到数据库
      try {
        await aiVideoApi.createGeneration({
          id: response.id,
          platform: 'toapi',
          model,
          prompt: prompt.trim(),
          duration,
          aspect_ratio: aspectRatio,
          resolution,
        });

        // 保存到 localStorage（兜底）
        localStorage.setItem('last_video_task_id', response.id);
      } catch (dbError) {
        console.error('保存到数据库失败:', dbError);
        // 保存失败不影响视频生成
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
      setPageState('error');
    }
  };

  // 任务完成回调
  const handleTaskComplete = async (task: UnifiedTask) => {
    setCompletedTask(task);
    setPageState('completed');

    // 更新数据库状态
    try {
      await aiVideoApi.updateGeneration(task.id, {
        status: task.status,
        progress: task.progress,
        video_url: task.videoUrl,
        error_message: task.error?.message,
        completed_at: task.status === 'completed' ? new Date().toISOString() : undefined,
      });

      // 清除 localStorage（任务已完成）
      localStorage.removeItem('last_video_task_id');
    } catch (error) {
      console.error('更新数据库失败:', error);
    }
  };

  // 任务错误回调
  const handleTaskError = (err: Error) => {
    setError(err.message);
    setPageState('error');
  };

  // 重置状态，生成新视频
  const handleReset = () => {
    setPageState('input');
    setTaskId(null);
    setCompletedTask(null);
    setError(null);
    setPrompt('');
    setFirstFrameImage(null);
    setLastFrameImage(null);
  };

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-800 dark:text-white">
                AI 视频生成
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mt-1">
                使用 AI 模型生成专业级视频内容
              </p>
            </div>
          </div>

          {/* 查看历史按钮 */}
          <button
            onClick={() => navigate('/ai-video/history')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            <History className="w-4 h-4" />
            查看历史
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：输入区域 */}
        <div className="space-y-6">
          {/* 模型选择 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <ModelSelector
              value={model}
              onChange={setModel}
              disabled={pageState === 'generating'}
            />
          </div>

          {/* 图片上传 */}
          {modelConfig?.capabilities?.supportImages && (
            <>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <ImageUploader
                  label="首帧图片（可选）"
                  value={firstFrameImage}
                  onChange={setFirstFrameImage}
                  disabled={pageState === 'generating'}
                />
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <ImageUploader
                  label="尾帧图片（可选）"
                  value={lastFrameImage}
                  onChange={setLastFrameImage}
                  disabled={pageState === 'generating'}
                />
              </div>
            </>
          )}

          {/* 参数配置 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
              参数配置
            </h3>
            <div className="space-y-6">
              {/* 固定时长提示 */}
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                <div className="text-sm text-blue-700 dark:text-blue-400">
                  视频时长：8 秒（固定）
                </div>
              </div>

              {/* 宽高比 */}
              <div>
                <label className="block text-sm font-medium mb-2">宽高比</label>
                <div className="flex gap-2">
                  {(['16:9', '9:16'] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      disabled={pageState === 'generating'}
                      className={`flex-1 px-4 py-2 rounded-xl font-medium ${aspectRatio === ratio ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700'} ${pageState === 'generating' ? 'opacity-50' : ''}`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              {/* 分辨率 */}
              <div>
                <label className="block text-sm font-medium mb-2">分辨率</label>
                <div className="flex gap-2">
                  {(['720p', '1080p', '4k'] as VideoResolution[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      disabled={pageState === 'generating'}
                      className={`flex-1 px-4 py-2 rounded-xl font-medium ${resolution === r ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-700'} ${pageState === 'generating' ? 'opacity-50' : ''}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 开关选项 */}
              <div className="space-y-3">
                <Toggle label="提示词优化器" checked={promptOptimizer} onChange={setPromptOptimizer} disabled={pageState === 'generating'} />
                <Toggle label="快速预处理" checked={fastPretreatment} onChange={setFastPretreatment} disabled={pageState === 'generating'} />
                <Toggle label="水印" checked={watermark} onChange={setWatermark} disabled={pageState === 'generating'} />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：提示词和结果 */}
        <div className="space-y-6">
          {/* 提示词输入 */}
          {pageState === 'input' && (
            <>
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  提示词
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="详细描述你想生成的视频内容，例如：一只可爱的猫咪在草地上奔跑，阳光明媚，镜头跟随..."
                  rows={10}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex items-center justify-between mt-2 text-sm text-slate-500 dark:text-slate-400">
                  <span>清晰详细的描述能获得更好的效果</span>
                  <span>{prompt.length} 字符</span>
                </div>
              </div>

              {/* 生成按钮 */}
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                className={`
                  w-full flex items-center justify-center gap-2
                  px-6 py-4 rounded-xl font-medium
                  transition-all duration-200
                  ${!prompt.trim()
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40'
                  }
                `}
              >
                <Sparkles className="w-5 h-5" />
                开始生成视频
              </button>
            </>
          )}

          {/* 生成中：任务监控 */}
          {pageState === 'generating' && (
            <>
              {taskId ? (
                <TaskMonitor
                  taskId={taskId}
                  platform="toapi"
                  onComplete={handleTaskComplete}
                  onError={handleTaskError}
                />
              ) : (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                    <p className="text-slate-600 dark:text-slate-400">正在提交任务...</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 完成：视频预览 */}
          {pageState === 'completed' && completedTask && (
            <VideoPreview
              task={completedTask}
              onReset={handleReset}
            />
          )}

          {/* 错误提示 */}
          {pageState === 'error' && error && (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-red-200 dark:border-red-800 p-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-700 dark:text-red-400 mb-2">
                    生成失败
                  </h3>
                  <p className="text-sm text-red-600 dark:text-red-300 mb-4">
                    {error}
                  </p>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded-xl font-medium transition-colors"
                  >
                    重新尝试
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Toggle 开关组件
function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
      <span className="text-sm font-medium">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${checked ? 'bg-blue-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white transform transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}
