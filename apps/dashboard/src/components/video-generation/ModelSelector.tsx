/**
 * 模型选择器组件（多平台支持）
 */

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getPlatform } from '../../api/video-generation.api';

interface ModelSelectorProps {
  platform: string;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

export default function ModelSelector({ platform, value, onChange, disabled = false }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 获取当前平台的模型列表
  const platformInstance = getPlatform(platform);
  const models = platformInstance.models;
  const selectedModel = models.find(m => m.id === value);

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
        <div className="absolute z-10 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onChange(model.id);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 ${value === model.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
            >
              <div className="font-medium text-slate-900 dark:text-white">{model.name}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">{model.description}</div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                {model.capabilities.fixedDuration
                  ? `固定时长: ${model.capabilities.fixedDuration}秒`
                  : `时长: ${model.capabilities.durationRange?.[0]}-${model.capabilities.durationRange?.[1]}秒`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 导出默认配置（兼容旧代码）
export const MODEL_CONFIGS = [];
