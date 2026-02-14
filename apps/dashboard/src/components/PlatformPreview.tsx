import React, { useState } from 'react';
import { Globe, Smartphone } from 'lucide-react';

interface PlatformPreviewProps {
  title: string;
  content: string;
  imageUrl?: string;
  selectedPlatforms: string[];
}

// 平台配置
const platformStyles: Record<string, {
  name: string;
  bg: string;
  accent: string;
  icon: string;
}> = {
  website: { name: '网站', bg: 'bg-slate-50', accent: 'text-blue-600', icon: '🌐' },
  xhs: { name: '小红书', bg: 'bg-red-50', accent: 'text-red-500', icon: '📕' },
  weibo: { name: '微博', bg: 'bg-orange-50', accent: 'text-orange-500', icon: '🔥' },
  x: { name: 'X/Twitter', bg: 'bg-gray-100', accent: 'text-black', icon: '𝕏' },
  douyin: { name: '抖音', bg: 'bg-gray-900', accent: 'text-white', icon: '🎵' },
};

export default function PlatformPreview({
  title,
  content,
  imageUrl,
  selectedPlatforms,
}: PlatformPreviewProps) {
  const [activePreview, setActivePreview] = useState(selectedPlatforms[0] || 'website');

  if (selectedPlatforms.length === 0) {
    return null;
  }

  // 网站预览 - 类似 zenithjoyai.com 的卡片风格
  const WebsitePreview = () => (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm max-w-md mx-auto">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
            ZJ
          </div>
          <div>
            <div className="font-medium text-gray-900">ZenithJoyAI</div>
            <div className="text-xs text-gray-500">刚刚发布</div>
          </div>
        </div>
        <h2 className="text-lg font-bold text-gray-900 leading-snug">{title || '标题预览'}</h2>
      </div>
      {/* Image */}
      {imageUrl && (
        <div className="px-4">
          <img src={imageUrl} alt="" className="w-full h-auto rounded-xl" />
        </div>
      )}
      {/* Content */}
      <div className="px-5 py-4">
        <p className="text-gray-700 whitespace-pre-line text-sm leading-relaxed">
          {content || '正文内容预览...'}
        </p>
      </div>
      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-4 text-gray-400 text-sm">
        <span>❤️ 喜欢</span>
        <span>💬 评论</span>
        <span>🔗 分享</span>
      </div>
    </div>
  );

  // 小红书预览
  const XhsPreview = () => (
    <div className="bg-white rounded-xl overflow-hidden shadow-lg max-w-sm mx-auto">
      {/* Image - 小红书以图为主 */}
      {imageUrl ? (
        <img src={imageUrl} alt="" className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="w-full aspect-[3/4] bg-gradient-to-br from-red-100 to-pink-100 flex items-center justify-center">
          <span className="text-6xl">📷</span>
        </div>
      )}
      {/* Content */}
      <div className="p-4">
        <h3 className="font-bold text-gray-900 mb-2 line-clamp-2">{title || '标题预览'}</h3>
        <p className="text-gray-600 text-sm line-clamp-3">{content || '正文内容...'}</p>
        {/* Author */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
          <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-white text-xs">Z</div>
          <span className="text-xs text-gray-500">ZenithJoyAI</span>
          <div className="ml-auto flex items-center gap-3 text-gray-400 text-xs">
            <span>❤️ 收藏</span>
            <span>💬 评论</span>
          </div>
        </div>
      </div>
    </div>
  );

  // 微博预览
  const WeiboPreview = () => (
    <div className="bg-white rounded-lg border border-gray-200 max-w-lg mx-auto">
      {/* Header */}
      <div className="p-4 flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold">ZJ</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-900">ZenithJoyAI</span>
            <span className="px-1 text-xs bg-orange-100 text-orange-600 rounded">V</span>
          </div>
          <div className="text-xs text-gray-500">刚刚 来自 网页版微博</div>
        </div>
      </div>
      {/* Content */}
      <div className="px-4 pb-3">
        <p className="text-gray-900 whitespace-pre-line">{title}{content ? '\n\n' + content : ''}</p>
      </div>
      {/* Image */}
      {imageUrl && (
        <div className="px-4 pb-3">
          <img src={imageUrl} alt="" className="w-48 h-48 object-cover rounded-lg" />
        </div>
      )}
      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-around text-gray-500 text-sm">
        <span>🔄 转发</span>
        <span>💬 评论</span>
        <span>👍 点赞</span>
      </div>
    </div>
  );

  // X/Twitter 预览
  const XPreview = () => (
    <div className="bg-white border border-gray-200 rounded-2xl max-w-lg mx-auto">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center text-white font-bold">ZJ</div>
          <div className="flex-1">
            <div className="flex items-center gap-1">
              <span className="font-bold text-gray-900">ZenithJoyAI</span>
              <span className="text-gray-500">@zenithjoyai</span>
              <span className="text-gray-400">· 刚刚</span>
            </div>
            {/* Content */}
            <p className="mt-2 text-gray-900 whitespace-pre-line">{title}{content ? '\n\n' + content : ''}</p>
            {/* Image */}
            {imageUrl && (
              <img src={imageUrl} alt="" className="mt-3 w-full h-auto rounded-2xl border border-gray-200" />
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center justify-between mt-4 pt-3 text-gray-500 pl-14">
          <span>💬</span>
          <span>🔄</span>
          <span>❤️</span>
          <span>📤</span>
        </div>
      </div>
    </div>
  );

  // 抖音预览 (竖版视频/图文风格)
  const DouyinPreview = () => (
    <div className="bg-black rounded-xl overflow-hidden max-w-xs mx-auto aspect-[9/16] relative">
      {/* Background */}
      {imageUrl ? (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-black" />
      )}
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      {/* Content */}
      <div className="absolute bottom-0 left-0 right-12 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-bold text-white">@ZenithJoyAI</span>
        </div>
        <p className="text-white text-sm line-clamp-3">{title}</p>
        {content && <p className="text-white/80 text-xs mt-1 line-clamp-2">{content}</p>}
        <div className="flex items-center gap-2 mt-2">
          <span className="px-2 py-0.5 bg-white/20 rounded text-white text-xs">#AI效率</span>
          <span className="px-2 py-0.5 bg-white/20 rounded text-white text-xs">#自媒体</span>
        </div>
      </div>
      {/* Side actions */}
      <div className="absolute right-2 bottom-20 flex flex-col items-center gap-4 text-white">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">❤️</div>
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">💬</div>
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">⭐</div>
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">↗️</div>
      </div>
    </div>
  );

  const renderPreview = () => {
    switch (activePreview) {
      case 'website': return <WebsitePreview />;
      case 'xhs': return <XhsPreview />;
      case 'weibo': return <WeiboPreview />;
      case 'x': return <XPreview />;
      case 'douyin': return <DouyinPreview />;
      default: return <WebsitePreview />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Platform tabs */}
      <div className="flex flex-wrap gap-2">
        {selectedPlatforms.map(platform => {
          const style = platformStyles[platform];
          return (
            <button
              key={platform}
              onClick={() => setActivePreview(platform)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activePreview === platform
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }
              `}
            >
              <span>{style?.icon}</span>
              {style?.name || platform}
            </button>
          );
        })}
      </div>

      {/* Preview area */}
      <div className={`p-6 rounded-xl ${platformStyles[activePreview]?.bg || 'bg-gray-50'}`}>
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-4">
          <Smartphone className="w-4 h-4" />
          <span>{platformStyles[activePreview]?.name || activePreview} 预览效果</span>
        </div>
        {renderPreview()}
      </div>
    </div>
  );
}
