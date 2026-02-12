/**
 * 视频参数配置组件（多平台支持）
 */

import { getPlatform } from '../../api/video-generation.api';
import type { AspectRatio, VideoResolution } from '../../types/video-generation.types';

interface VideoParamsProps {
  platform: string;
  model: string;
  aspectRatio: AspectRatio;
  resolution: VideoResolution;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onResolutionChange: (resolution: VideoResolution) => void;
  disabled?: boolean;
}

export default function VideoParams(props: VideoParamsProps) {
  // 获取平台和模型配置
  const platformInstance = getPlatform(props.platform);
  const modelConfig = platformInstance.getModel(props.model);

  if (!modelConfig) {
    return <div className="text-red-500">模型配置未找到</div>;
  }

  const { capabilities } = modelConfig;

  return (
    <div className="space-y-6">
      {/* 时长显示（ToAPI 固定 8秒） */}
      {capabilities.fixedDuration && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            视频时长
          </label>
          <div className="px-4 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl text-center">
            <span className="font-medium text-slate-900 dark:text-white">
              {capabilities.fixedDuration} 秒（固定）
            </span>
          </div>
        </div>
      )}

      {/* 宽高比选择 */}
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          宽高比
        </label>
        <div className="flex gap-2">
          {capabilities.aspectRatios.map((ratio) => (
            <button
              key={ratio}
              onClick={() => props.onAspectRatioChange(ratio as AspectRatio)}
              disabled={props.disabled}
              className={`
                flex-1 px-4 py-2 rounded-xl font-medium transition-colors
                ${props.aspectRatio === ratio
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }
                ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {/* 分辨率选择 */}
      {capabilities.resolutions && capabilities.resolutions.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            分辨率
          </label>
          <div className="flex gap-2">
            {capabilities.resolutions.map((res) => (
              <button
                key={res}
                onClick={() => props.onResolutionChange(res as VideoResolution)}
                disabled={props.disabled}
                className={`
                  flex-1 px-4 py-2 rounded-xl font-medium transition-colors
                  ${props.resolution === res
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }
                  ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                {res}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
