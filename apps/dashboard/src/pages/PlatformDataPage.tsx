import { useState, useEffect } from 'react';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import type { Platform, PlatformData } from '../api/platform-data.api';
import { fetchPlatformData } from '../api/platform-data.api';

const platformConfig: Record<Platform, { name: string; color: string; fields: string[] }> = {
  douyin: {
    name: '抖音',
    color: '#000000',
    fields: ['aweme_id', 'title', 'views', 'likes', 'comments', 'shares', 'favorites', 'publishTime', 'scraped_at']
  },
  kuaishou: {
    name: '快手',
    color: '#FF6600',
    fields: ['photo_id', 'caption', 'views', 'likes', 'comments', 'shares', 'favorites', 'publishTime', 'scraped_at']
  },
  xiaohongshu: {
    name: '小红书',
    color: '#FF2442',
    fields: ['note_id', 'title', 'views', 'likes', 'comments', 'shares', 'favorites', 'exposure', 'publishTime', 'scraped_at']
  },
  toutiao: {
    name: '今日头条',
    color: '#D22828',
    fields: ['article_id', 'title', 'views', 'likes', 'comments', 'shares', 'favorites', 'publishTime', 'scraped_at']
  },
  weibo: {
    name: '微博',
    color: '#E6162D',
    fields: ['weibo_id', 'content', 'views', 'likes', 'comments', 'reposts', 'publishTime', 'scraped_at']
  },
  zhihu: {
    name: '知乎',
    color: '#0084FF',
    fields: ['question_id', 'title', 'views', 'voteup_count', 'comments', 'favorites', 'publishTime', 'scraped_at']
  },
  channels: {
    name: '视频号',
    color: '#07C160',
    fields: ['title', 'views', 'likes', 'comments', 'shares', 'favorites', 'publishTime', 'scraped_at']
  },
};

// 字段中文名映射
const fieldLabels: Record<string, string> = {
  aweme_id: '作品ID',
  photo_id: '作品ID',
  note_id: '笔记ID',
  article_id: '文章ID',
  weibo_id: '微博ID',
  question_id: '问题ID',
  title: '标题',
  content: '内容',
  caption: '描述',
  views: '浏览量',
  likes: '点赞数',
  comments: '评论数',
  shares: '分享数',
  favorites: '收藏数',
  reposts: '转发数',
  voteup_count: '赞同数',
  exposure: '曝光量',
  publishTime: '发布时间',
  scraped_at: '采集时间',
};

export default function PlatformDataPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('douyin');
  const [data, setData] = useState<PlatformData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('scraped_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadData();
  }, [selectedPlatform]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPlatformData(selectedPlatform);
      if (result.success) {
        setData(result.data);
      } else {
        setError(result.error || '加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const sortedData = [...data].sort((a, b) => {
    const aVal = (a as any)[sortBy];
    const bVal = (b as any)[sortBy];
    if (aVal === bVal) return 0;
    const comparison = aVal > bVal ? 1 : -1;
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const platformFields = platformConfig[selectedPlatform].fields;

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return '-';
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w';
    }
    return num.toLocaleString();
  };

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">平台数据展示</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">查看各平台采集的原始数据</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 平台选择 */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(platformConfig) as Platform[]).map((platform) => (
          <button
            key={platform}
            onClick={() => setSelectedPlatform(platform)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              selectedPlatform === platform
                ? 'text-white shadow-lg'
                : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700'
            }`}
            style={
              selectedPlatform === platform
                ? { backgroundColor: platformConfig[platform].color }
                : undefined
            }
          >
            {platformConfig[platform].name}
            {data.length > 0 && selectedPlatform === platform && (
              <span className="ml-2 text-xs opacity-80">({data.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">❌ {error}</p>
        </div>
      )}

      {/* 数据表格 */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-gray-500 dark:text-gray-400">加载中...</p>
            </div>
          </div>
        ) : sortedData.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-400 dark:text-gray-500">暂无数据</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900 border-b border-gray-200 dark:border-slate-700">
                <tr>
                  {platformFields.map((field) => (
                    <th
                      key={field}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                      onClick={() => toggleSort(field)}
                    >
                      <div className="flex items-center gap-1">
                        {fieldLabels[field] || field}
                        <SortIcon field={field} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {sortedData.map((item, index) => (
                  <tr key={index} className="hover:bg-gray-50 dark:hover:bg-slate-900/50 transition-colors">
                    {platformFields.map((field) => {
                      const value = (item as any)[field];
                      const isDate = field.includes('Time') || field === 'scraped_at';
                      const isNumber = typeof value === 'number';

                      return (
                        <td key={field} className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                          {isDate ? formatDateTime(value) : isNumber ? formatNumber(value) : value || '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 数据统计 */}
      {sortedData.length > 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
          共 {sortedData.length} 条数据
        </div>
      )}
    </div>
  );
}
