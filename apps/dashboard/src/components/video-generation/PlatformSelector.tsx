/**
 * 平台选择器组件
 *
 * 允许用户选择视频生成平台
 */

import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { getAllPlatforms } from '../../api/video-generation.api';

interface PlatformSelectorProps {
  value: string;
  onChange: (platform: string) => void;
  disabled?: boolean;
}

export default function PlatformSelector({ value, onChange, disabled = false }: PlatformSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const platforms = getAllPlatforms();
  const selectedPlatform = platforms.find(p => p.id === value);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
        选择平台
      </label>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between px-4 py-3 rounded-xl border
          bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 cursor-pointer'}
        `}
      >
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <div className="text-left">
            <div className="font-medium text-slate-900 dark:text-white">
              {selectedPlatform?.name || 'Select Platform'}
            </div>
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {platforms.length} 个平台可用
            </div>
          </div>
        </div>
        <ChevronDown className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-10 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden">
          {platforms.map((platform) => (
            <button
              key={platform.id}
              type="button"
              onClick={() => {
                onChange(platform.id);
                setIsOpen(false);
              }}
              className={`
                w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                hover:bg-slate-50 dark:hover:bg-slate-700
                ${value === platform.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}
              `}
            >
              <Sparkles className="w-5 h-5 text-purple-500" />
              <div className="flex-1">
                <div className="font-medium text-slate-900 dark:text-white">
                  {platform.name}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {platform.models.length} 个模型
                </div>
              </div>
              {value === platform.id && (
                <div className="w-2 h-2 rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
