/**
 * AI 视频生成页面（多平台支持）
 */

import { useState } from 'react';
import { Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import PlatformSelector from '../components/video-generation/PlatformSelector';
import ModelSelector from '../components/video-generation/ModelSelector';
import VideoParams from '../components/video-generation/VideoParams';
import TaskMonitor from '../components/video-generation/TaskMonitor';
import VideoPreview from '../components/video-generation/VideoPreview';
import { createVideoGeneration, pollTaskStatus } from '../api/video-generation.api';
import type { AspectRatio, VideoResolution } from '../types/video-generation.types';
import type { UnifiedTask } from '../api/platforms';

type PageState = 'input' | 'generating' | 'completed' | 'error';

export default function AiVideoGenerationPage() {
  // 平台和模型
  const [platform, setPlatform] = useState('toapi');
  const [model, setModel] = useState('veo3.1-fast');
  const [prompt, setPrompt] = useState('');

  // 参数
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<VideoResolution>('720p');

  // 任务状态
  const [pageState, setPageState] = useState<PageState>('input');
  const [currentTask, setCurrentTask] = useState<UnifiedTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 提交生成请求
  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError('请输入提示词');
      return;
    }

    setError(null);
    setPageState('generating');
    setCurrentTask(null);

    try {
      // 创建任务
      const task = await createVideoGeneration({
        platform,
        model,
        prompt: prompt.trim(),
        aspectRatio,
        resolution,
      });

      console.log('[Page] Task created:', task);
      setCurrentTask(task);

      // 开始轮询状态
      pollTaskStatus(
        platform,
        task.id,
        (updatedTask) => {
          console.log('[Page] Task updated:', updatedTask);
          setCurrentTask(updatedTask);
        },
        3000,  // 3秒轮询
        300000 // 5分钟超时
      )
        .then((completedTask) => {
          console.log('[Page] Task completed:', completedTask);
          setCurrentTask(completedTask);
          setPageState('completed');
        })
        .catch((err) => {
          console.error('[Page] Task error:', err);
          setError(err.message || '生成失败');
          setPageState('error');
        });

    } catch (err) {
      console.error('[Page] Submit error:', err);
      setError(err instanceof Error ? err.message : '提交失败');
      setPageState('error');
    }
  };

  // 重置状态
  const handleReset = () => {
    setPageState('input');
    setCurrentTask(null);
    setError(null);
    setPrompt('');
  };

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
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
      </div>

      {/* 主内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左侧：配置区域 */}
        <div className="space-y-6">
          {/* 平台选择 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <PlatformSelector
              value={platform}
              onChange={(p) => {
                setPlatform(p);
                // 切换平台时重置模型
                setModel('veo3.1-fast');
              }}
              disabled={pageState === 'generating'}
            />
          </div>

          {/* 模型选择 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <ModelSelector
              platform={platform}
              value={model}
              onChange={setModel}
              disabled={pageState === 'generating'}
            />
          </div>

          {/* 参数配置 */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
              参数配置
            </h3>
            <VideoParams
              platform={platform}
              model={model}
              aspectRatio={aspectRatio}
              resolution={resolution}
              onAspectRatioChange={setAspectRatio}
              onResolutionChange={setResolution}
              disabled={pageState === 'generating'}
            />
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
              {currentTask ? (
                <TaskMonitor
                  task={currentTask}
                  onComplete={() => setPageState('completed')}
                  onError={(err) => {
                    setError(err.message);
                    setPageState('error');
                  }}
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
          {pageState === 'completed' && currentTask && (
            <VideoPreview
              task={currentTask}
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
                  <p className="text-sm text-red-600 dark:text-red-300 mb-4 whitespace-pre-wrap">
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
