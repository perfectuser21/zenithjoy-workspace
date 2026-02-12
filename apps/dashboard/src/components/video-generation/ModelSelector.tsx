import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { VideoModel, ModelConfig } from '../../types/video-generation.types';

const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: 'MiniMax-Hailuo-02',
    name: 'MiniMax 海螺 02',
    description: '高质量视频生成，支持 5-10 秒',
    maxDuration: 10,
    supportedResolutions: ['512p', '768p', '1080p'],
    supportFirstFrame: true,
    supportLastFrame: true,
  },
  {
    id: 'Sora-2',
    name: 'Sora 2',
    description: 'OpenAI 最新视频生成模型',
    maxDuration: 10,
    supportedResolutions: ['512p', '768p', '1080p'],
    supportFirstFrame: true,
    supportLastFrame: false,
  },
  {
    id: 'Vail-3',
    name: 'Vail 3',
    description: '快速视频生成',
    maxDuration: 5,
    supportedResolutions: ['512p', '768p'],
    supportFirstFrame: false,
    supportLastFrame: false,
  },
  {
    id: 'Douyin-VideoGen',
    name: '豆包视频生成',
    description: '字节跳动视频生成',
    maxDuration: 10,
    supportedResolutions: ['512p', '768p', '1080p'],
    supportFirstFrame: true,
    supportLastFrame: true,
  },
  {
    id: 'Luma-1.6',
    name: 'Luma 1.6',
    description: '高清视频生成',
    maxDuration: 10,
    supportedResolutions: ['768p', '1080p'],
    supportFirstFrame: true,
    supportLastFrame: true,
  },
];

interface ModelSelectorProps {
  value: VideoModel;
  onChange: (model: VideoModel) => void;
  disabled?: boolean;
}

export default function ModelSelector({ value, onChange, disabled = false }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedModel = MODEL_CONFIGS.find(m => m.id === value);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        选择模型
      </label>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 ${disabled ? 'opacity-50' : 'hover:border-blue-400'}`}
      >
        <div className="flex-1 text-left">
          <div className="font-medium text-slate-900 dark:text-white">{selectedModel?.name}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">{selectedModel?.description}</div>
        </div>
        <ChevronDown className={`w-5 h-5 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute z-20 w-full mt-2 py-2 bg-white dark:bg-slate-800 rounded-xl border shadow-xl max-h-96 overflow-y-auto">
            {MODEL_CONFIGS.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => { onChange(model.id); setIsOpen(false); }}
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 ${value === model.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              >
                <div className="font-medium">{model.name}</div>
                <div className="text-sm text-slate-500">{model.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { MODEL_CONFIGS };
