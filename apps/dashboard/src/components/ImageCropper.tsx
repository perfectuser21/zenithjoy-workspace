import React, { useState, useMemo } from 'react';
import { Check, Image as ImageIcon } from 'lucide-react';
import type { PlatformSpec} from '../api/publish.api';
import { publishApi } from '../api/publish.api';

interface ImageCropperProps {
  imageUrl: string;
  imagePath: string;
  platforms: PlatformSpec[];
  selectedPlatforms: string[];
  onCropComplete?: (platform: string, aspectRatio: string) => void;
}

// 平台图标颜色
const platformColors: Record<string, string> = {
  xhs: 'bg-red-500',
  weibo: 'bg-orange-500',
  x: 'bg-black',
  douyin: 'bg-gray-800',
  website: 'bg-blue-600',
};

// 比例名称
const ratioNames: Record<string, string> = {
  '1:1': '正方形',
  '3:4': '竖版',
  '4:3': '横版',
  '9:16': '全屏竖版',
  '16:9': '宽屏横版',
  '4:5': 'Instagram',
  '*': '原图',
};

export default function ImageCropper({
  imageUrl,
  imagePath,
  platforms,
  selectedPlatforms,
}: ImageCropperProps) {
  const [activeRatio, setActiveRatio] = useState<string>('1:1');

  // 获取选中平台支持的所有比例
  const availableRatios = useMemo(() => {
    const ratios = new Set<string>();
    platforms
      .filter(p => selectedPlatforms.includes(p.name))
      .forEach(p => {
        p.imageSpecs.aspectRatios.forEach(r => {
          if (r !== '*') ratios.add(r);
        });
      });
    return Array.from(ratios);
  }, [platforms, selectedPlatforms]);

  // 计算裁剪区域样式
  const getCropStyle = (ratio: string) => {
    if (ratio === '*') return { paddingTop: '75%' }; // 默认 4:3
    const [w, h] = ratio.split(':').map(Number);
    return { paddingTop: `${(h / w) * 100}%` };
  };

  // 哪些平台支持当前选中的比例
  const platformsForRatio = useMemo(() => {
    return platforms
      .filter(p => selectedPlatforms.includes(p.name))
      .filter(p => p.imageSpecs.aspectRatios.includes(activeRatio) || p.imageSpecs.aspectRatios.includes('*'));
  }, [platforms, selectedPlatforms, activeRatio]);

  if (selectedPlatforms.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        请先选择发布平台
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 比例选择器 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          选择裁剪比例
        </label>
        <div className="flex flex-wrap gap-2">
          {availableRatios.map(ratio => (
            <button
              key={ratio}
              onClick={() => setActiveRatio(ratio)}
              className={`
                px-3 py-2 rounded-lg border-2 transition-all text-sm
                ${activeRatio === ratio
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 hover:border-gray-300'
                }
              `}
            >
              <span className="font-mono">{ratio}</span>
              <span className="ml-1 text-xs opacity-70">{ratioNames[ratio] || ''}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 裁剪预览 */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* 原图预览 */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">原图</h4>
          <div className="relative bg-gray-100 rounded-lg overflow-hidden">
            <img
              src={imageUrl}
              alt="原图"
              className="w-full h-auto"
            />
          </div>
        </div>

        {/* 裁剪后预览 */}
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            {activeRatio} 预览
          </h4>
          <div
            className="relative bg-gray-100 rounded-lg overflow-hidden"
            style={getCropStyle(activeRatio)}
          >
            <img
              src={imageUrl}
              alt={`${activeRatio} 预览`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        </div>
      </div>

      {/* 平台适配说明 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          此比例适用于
        </h4>
        <div className="flex flex-wrap gap-2">
          {platformsForRatio.map(platform => (
            <div
              key={platform.name}
              className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200"
            >
              <div className={`w-5 h-5 rounded ${platformColors[platform.name] || 'bg-gray-500'} flex items-center justify-center text-white text-xs`}>
                {platform.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm">{platform.displayName}</span>
              <Check className="w-4 h-4 text-green-500" />
            </div>
          ))}
        </div>
      </div>

      {/* 平台比例要求一览 */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          查看各平台图片要求
        </summary>
        <div className="mt-3 space-y-2">
          {platforms
            .filter(p => selectedPlatforms.includes(p.name))
            .map(platform => (
              <div key={platform.name} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className={`w-8 h-8 rounded-lg ${platformColors[platform.name] || 'bg-gray-500'} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
                  {platform.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{platform.displayName}</div>
                  <div className="text-gray-500 text-xs mt-1">
                    比例: {platform.imageSpecs.aspectRatios.join(', ')}
                  </div>
                  <div className="text-gray-500 text-xs">
                    最大: {platform.imageSpecs.maxWidth}x{platform.imageSpecs.maxHeight}
                  </div>
                  <div className="text-gray-500 text-xs">
                    最多: {platform.maxImages} 张
                  </div>
                </div>
              </div>
            ))}
        </div>
      </details>
    </div>
  );
}
