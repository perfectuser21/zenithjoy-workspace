import { useState, useEffect } from 'react';
import {
  BarChart3,
  Video,
  Image,
  TrendingUp,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  RefreshCw,
  Filter,
  X,
  Calendar,
  Clock
} from 'lucide-react';

interface ContentItem {
  id: number;
  platform: string;
  content_type: string;
  title: string;
  publish_time: string;
  status: string;
  latest_views: number;
  latest_likes: number;
  latest_shares: number;
  latest_comments: number;
  latest_favorites: number;
  latest_follower_gain: number;
}

interface MetricSnapshot {
  id: number;
  content_id: number;
  days_after_publish: number;
  scraped_at: string;
  views: number;
  click_rate: number | null;
  completion_rate: number | null;
  completion_rate_5s: number | null;
  bounce_rate: number | null;
  avg_play_duration: string | null;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  profile_visits: number;
  follower_gain: number;
}

interface Stats {
  by_type: Array<{
    content_type: string;
    count: string;
    total_views: string;
    total_likes: string;
    avg_views: string;
  }>;
  total: {
    total_count: string;
    total_views: string;
    total_likes: string;
    total_follower_gain: string;
  };
}

const API_BASE = import.meta.env.VITE_API_URL || 'https://dashboard.zenjoymedia.media';

// 详情弹窗组件
function DetailModal({
  item,
  onClose
}: {
  item: ContentItem;
  onClose: () => void;
}) {
  const [metrics, setMetrics] = useState<MetricSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/platform-data/${item.id}/metrics`);
        const data = await res.json();
        if (data.success) {
          setMetrics(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMetrics();
  }, [item.id]);

  const formatNumber = (num: number) => {
    if (num >= 10000) return (num / 10000).toFixed(1) + '万';
    return num?.toLocaleString() || '0';
  };

  // 计算柱状图高度
  const maxViews = Math.max(...metrics.map(m => Number(m.views) || 0), 1);
  const targetDays = [1, 2, 3, 5, 7, 15, 30];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl">
        {/* 头部 */}
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                item.content_type === '图文'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {item.content_type === '图文' ? <Image className="w-3 h-3 mr-1" /> : <Video className="w-3 h-3 mr-1" />}
                {item.content_type}
              </span>
              <span className="text-xs text-gray-400">ID: {item.id}</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 line-clamp-2">{item.title}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {item.publish_time ? new Date(item.publish_time).toLocaleDateString('zh-CN') : '-'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          {/* 最新指标卡片 - 根据类型显示不同指标 */}
          {item.content_type === '图文' ? (
            /* 图文/帖子指标 */
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <Eye className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{formatNumber(item.latest_views)}</p>
                <p className="text-xs text-gray-500">阅读</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <Heart className="w-4 h-4 text-red-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{item.latest_likes}</p>
                <p className="text-xs text-gray-500">点赞</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <MessageCircle className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{item.latest_comments}</p>
                <p className="text-xs text-gray-500">评论</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <Share2 className="w-4 h-4 text-green-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{item.latest_shares}</p>
                <p className="text-xs text-gray-500">分享</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <BarChart3 className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{item.latest_favorites}</p>
                <p className="text-xs text-gray-500">收藏</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <TrendingUp className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                <p className="text-lg font-bold text-gray-900">{item.latest_follower_gain}</p>
                <p className="text-xs text-gray-500">涨粉</p>
              </div>
            </div>
          ) : (
            /* 视频指标 */
            <div className="space-y-4 mb-6">
              {/* 第一行：核心指标 */}
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <Eye className="w-4 h-4 text-gray-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{formatNumber(item.latest_views)}</p>
                  <p className="text-xs text-gray-500">播放</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <Heart className="w-4 h-4 text-red-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{item.latest_likes}</p>
                  <p className="text-xs text-gray-500">点赞</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <MessageCircle className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{item.latest_comments}</p>
                  <p className="text-xs text-gray-500">评论</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <Share2 className="w-4 h-4 text-green-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{item.latest_shares}</p>
                  <p className="text-xs text-gray-500">分享</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <BarChart3 className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{item.latest_favorites}</p>
                  <p className="text-xs text-gray-500">收藏</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <TrendingUp className="w-4 h-4 text-orange-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{item.latest_follower_gain}</p>
                  <p className="text-xs text-gray-500">涨粉</p>
                </div>
              </div>
              {/* 第二行：视频特有指标（从详细数据获取） */}
              {metrics.length > 0 && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-blue-700">
                      {metrics[metrics.length - 1]?.completion_rate ? `${metrics[metrics.length - 1].completion_rate}%` : '-'}
                    </p>
                    <p className="text-xs text-blue-600">完播率</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-blue-700">
                      {metrics[metrics.length - 1]?.completion_rate_5s ? `${metrics[metrics.length - 1].completion_rate_5s}%` : '-'}
                    </p>
                    <p className="text-xs text-blue-600">5s完播</p>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-orange-700">
                      {metrics[metrics.length - 1]?.bounce_rate ? `${metrics[metrics.length - 1].bounce_rate}%` : '-'}
                    </p>
                    <p className="text-xs text-orange-600">跳出率</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <p className="text-lg font-bold text-green-700">
                      {metrics[metrics.length - 1]?.avg_play_duration || '-'}
                    </p>
                    <p className="text-xs text-green-600">平均时长</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 增长曲线 */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              数据增长曲线（发布后天数）
            </h3>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : metrics.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                暂无历史数据，持续采集中...
              </div>
            ) : (
              <>
                {/* 播放量柱状图 */}
                <div className="mb-6">
                  <p className="text-sm text-gray-500 mb-3">播放量</p>
                  <div className="flex items-end gap-2 h-32">
                    {targetDays.map(day => {
                      const metric = metrics.find(m => m.days_after_publish === day);
                      const views = Number(metric?.views) || 0;
                      const height = (views / maxViews) * 100;
                      const hasData = !!metric;

                      return (
                        <div key={day} className="flex-1 flex flex-col items-center">
                          <div className="w-full flex flex-col items-center justify-end h-24">
                            {hasData && (
                              <span className="text-xs text-gray-600 mb-1">
                                {formatNumber(views)}
                              </span>
                            )}
                            <div
                              className={`w-full rounded-t transition-all ${
                                hasData ? 'bg-blue-500' : 'bg-gray-200'
                              }`}
                              style={{ height: hasData ? `${Math.max(height, 5)}%` : '5%' }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 mt-2">D{day}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 详细数据表格 - 根据类型显示不同列 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 text-gray-500 font-medium">天数</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">
                          {item.content_type === '图文' ? '阅读' : '播放'}
                        </th>
                        {item.content_type !== '图文' && (
                          <>
                            <th className="text-right py-2 px-2 text-gray-500 font-medium">完播率</th>
                            <th className="text-right py-2 px-2 text-gray-500 font-medium">5s完播</th>
                          </>
                        )}
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">点赞</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">评论</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">分享</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium">采集时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map(m => (
                        <tr key={m.id} className="border-b border-gray-100">
                          <td className="py-2 px-2 font-medium">Day {m.days_after_publish}</td>
                          <td className="py-2 px-2 text-right">{formatNumber(Number(m.views))}</td>
                          {item.content_type !== '图文' && (
                            <>
                              <td className="py-2 px-2 text-right text-blue-600">
                                {m.completion_rate ? `${m.completion_rate}%` : '-'}
                              </td>
                              <td className="py-2 px-2 text-right text-blue-600">
                                {m.completion_rate_5s ? `${m.completion_rate_5s}%` : '-'}
                              </td>
                            </>
                          )}
                          <td className="py-2 px-2 text-right">{m.likes}</td>
                          <td className="py-2 px-2 text-right">{m.comments}</td>
                          <td className="py-2 px-2 text-right">{m.shares}</td>
                          <td className="py-2 px-2 text-right text-gray-400">
                            {new Date(m.scraped_at).toLocaleDateString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 聚合内容项（跨平台）
interface AggregatedContent {
  id: number;
  title: string;
  first_publish_time: string;
  total_views: string;
  total_likes: string;
  total_comments: string;
  total_shares: string;
  total_favorites: string;
  platforms: string[];
  platform_count: string;
  is_top_performer: boolean;
  items: Array<{
    id: number;
    platform: string;
    content_type: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    favorites: number;
    publish_time: string;
  }>;
}

// 聚合数据结构
interface GroupedData {
  form: string;
  data: AggregatedContent[];
  form_stats: Record<string, { count: number; total_views: number; total_likes: number }>;
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
  averages: {
    avg_views: number;
    avg_likes: number;
  };
}

export default function ContentData() {
  const [contents, setContents] = useState<ContentItem[]>([]);
  const [groupedData, setGroupedData] = useState<GroupedData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');
  const [selectedForm, setSelectedForm] = useState<'视频' | '图文' | '长文'>('视频');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState({
    platform: '',  // 默认显示全部平台
    content_type: '',
  });

  // 平台配置
  const platforms = [
    { value: '', label: '全部平台', color: 'gray' },
    { value: 'douyin', label: '抖音', color: 'black' },
    { value: 'kuaishou', label: '快手', color: 'orange' },
    { value: 'xiaohongshu', label: '小红书', color: 'red' },
    { value: 'toutiao', label: '今日头条', color: 'red' },
    { value: 'weibo', label: '微博', color: 'orange' },
    { value: 'channels', label: '视频号', color: 'green' },
  ];

  // 平台名称映射（供聚合视图使用）
  const platformNames: Record<string, { name: string; bg: string; text: string }> = {
    douyin: { name: '抖音', bg: 'bg-gray-900', text: 'text-white' },
    kuaishou: { name: '快手', bg: 'bg-orange-500', text: 'text-white' },
    xiaohongshu: { name: '小红书', bg: 'bg-red-500', text: 'text-white' },
    toutiao: { name: '头条', bg: 'bg-red-600', text: 'text-white' },
    weibo: { name: '微博', bg: 'bg-orange-400', text: 'text-white' },
    channels: { name: '视频号', bg: 'bg-green-500', text: 'text-white' },
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.platform) params.append('platform', filter.platform);
      if (filter.content_type) params.append('content_type', filter.content_type);
      params.append('limit', '100');

      const [contentsRes, statsRes, groupedRes] = await Promise.all([
        fetch(`${API_BASE}/api/platform-data?${params}`),
        fetch(`${API_BASE}/api/platform-data/stats?${params}`),
        fetch(`${API_BASE}/api/platform-data/grouped?form=${encodeURIComponent(selectedForm)}&page=${currentPage}&limit=20`)
      ]);

      const contentsData = await contentsRes.json();
      const statsData = await statsRes.json();
      const groupedResult = await groupedRes.json();

      if (contentsData.success) setContents(contentsData.data);
      if (statsData.success) setStats(statsData);
      if (groupedResult.success) setGroupedData(groupedResult);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 切换形式时重置页码
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedForm]);

  useEffect(() => {
    fetchData();
  }, [filter, selectedForm, currentPage]);

  const formatNumber = (num: number) => {
    if (num >= 10000) return (num / 10000).toFixed(1) + '万';
    return num?.toLocaleString() || '0';
  };

  const videoStats = stats?.by_type.find(s => s.content_type === '视频' || s.content_type?.includes('视频'));
  const imageStats = stats?.by_type.find(s => s.content_type === '图文');

  return (
    <div className="space-y-6">
      {/* 详情弹窗 */}
      {selectedItem && (
        <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">数据中心</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">查看各平台内容数据表现，点击查看详情</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-50 shadow-lg shadow-blue-500/25 magnetic-btn"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-slate-700 tilt-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总内容数</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {stats?.total?.total_count || 0}
              </p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-slate-700 tilt-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总播放量</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {formatNumber(parseInt(stats?.total?.total_views || '0'))}
              </p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-green-500/25">
              <Eye className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-slate-700 tilt-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总点赞数</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {formatNumber(parseInt(stats?.total?.total_likes || '0'))}
              </p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/25">
              <Heart className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-gray-200 dark:border-slate-700 tilt-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">涨粉数</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {formatNumber(parseInt(stats?.total?.total_follower_gain || '0'))}
              </p>
            </div>
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/25">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* 图文 vs 视频对比 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 rounded-2xl p-6 border border-orange-200 dark:border-orange-800/50 shimmer-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Image className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">图文内容</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{imageStats?.count || 0} 篇</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总播放</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatNumber(parseInt(imageStats?.total_views || '0'))}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">平均播放</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatNumber(Math.round(parseFloat(imageStats?.avg_views || '0')))}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-2xl p-6 border border-blue-200 dark:border-blue-800/50 shimmer-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
              <Video className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">视频内容</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{videoStats?.count || 0} 个</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">总播放</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatNumber(parseInt(videoStats?.total_views || '0'))}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">平均播放</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{formatNumber(Math.round(parseFloat(videoStats?.avg_views || '0')))}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-slate-800 rounded-2xl p-4 border border-gray-200 dark:border-slate-700 shadow-sm">
        <Filter className="w-5 h-5 text-gray-400 dark:text-gray-500" />

        {/* 视图模式切换 */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              viewMode === 'list'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            列表视图
          </button>
          <button
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              viewMode === 'grouped'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            聚合视图 ({groupedData?.pagination?.total_items || 0})
          </button>
        </div>

        {viewMode === 'list' && (
          <>
            {/* 平台筛选 - Tab 样式 */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {platforms.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setFilter({ ...filter, platform: p.value })}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                    filter.platform === p.value
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 类型筛选 */}
            <select
              value={filter.content_type}
              onChange={(e) => setFilter({ ...filter, content_type: e.target.value })}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">全部类型</option>
              <option value="图文">图文</option>
              <option value="视频">视频</option>
              <option value="微头条">微头条</option>
              <option value="文章">文章</option>
              <option value="长文">长文</option>
              <option value="文字">文字</option>
            </select>

            <span className="text-sm text-gray-500">
              共 {contents.length} 条内容
            </span>
          </>
        )}
      </div>

      {/* 聚合视图 - 按内容形式分组，可展开看各平台数据 */}
      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {/* 形式切换标签 */}
          <div className="flex gap-2">
            {(['视频', '图文', '长文'] as const).map((formType) => {
              const stats = groupedData?.form_stats[formType];
              const icon = formType === '视频' ? '🎬' : formType === '图文' ? '📷' : '📝';
              const isActive = selectedForm === formType;

              return (
                <button
                  key={formType}
                  onClick={() => setSelectedForm(formType)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                    isActive
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{formType}</span>
                  <span className={`text-sm ${isActive ? 'text-blue-100' : 'text-gray-400'}`}>
                    ({stats?.count || 0})
                  </span>
                </button>
              );
            })}
          </div>

          {/* 当前形式的统计 */}
          {groupedData?.pagination && (
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
              <div>
                <span className="text-gray-500">共 </span>
                <span className="font-bold text-lg">{groupedData.pagination.total_items}</span>
                <span className="text-gray-500"> 条{selectedForm}内容</span>
                <span className="text-gray-400 text-sm ml-2">
                  (平均{selectedForm === '视频' ? '播放' : '阅读'}: {formatNumber(groupedData.averages?.avg_views || 0)})
                </span>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-gray-500">总{selectedForm === '视频' ? '播放' : '阅读'}：</span>
                  <span className="font-bold">{formatNumber(groupedData.form_stats[selectedForm]?.total_views || 0)}</span>
                </div>
                <div>
                  <span className="text-gray-500">总点赞：</span>
                  <span className="font-bold">{formatNumber(groupedData.form_stats[selectedForm]?.total_likes || 0)}</span>
                </div>
              </div>
            </div>
          )}

          {/* 内容列表 */}
          {loading ? (
            <div className="text-center py-12 text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : !groupedData?.data?.length ? (
            <div className="text-center py-12 text-gray-500 bg-white rounded-xl border border-gray-200">
              暂无{selectedForm}内容
            </div>
          ) : (
            <div className="space-y-2">
              {groupedData.data.map((content) => {
                const isExpanded = expandedItems.has(content.id);
                const hasMultiplePlatforms = content.items.length > 1;
                const publishDate = new Date(content.first_publish_time).toLocaleDateString('zh-CN');

                return (
                  <div key={content.id} className={`bg-white rounded-lg border overflow-hidden ${content.is_top_performer ? 'border-yellow-400 ring-1 ring-yellow-200' : 'border-gray-200'}`}>
                    {/* 主行 - 点击展开 */}
                    <div
                      className={`p-4 flex items-center justify-between ${hasMultiplePlatforms ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      onClick={() => {
                        if (hasMultiplePlatforms) {
                          setExpandedItems(prev => {
                            const next = new Set(prev);
                            if (next.has(content.id)) {
                              next.delete(content.id);
                            } else {
                              next.add(content.id);
                            }
                            return next;
                          });
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {content.is_top_performer && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800 font-medium">
                              🔥 热门
                            </span>
                          )}
                          <h4 className="font-medium text-gray-900 line-clamp-1">{content.title}</h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-400">{publishDate}</span>
                          {content.platforms.map((p) => {
                            const pInfo = platformNames[p] || { name: p, bg: 'bg-gray-200', text: 'text-gray-700' };
                            return (
                              <span key={p} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${pInfo.bg} ${pInfo.text}`}>
                                {pInfo.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 ml-4">
                        {/* 视频：播放、点赞、评论、分享 */}
                        {selectedForm === '视频' && (
                          <>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_views))}</div>
                              <div className="text-xs text-gray-500">播放</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_likes))}</div>
                              <div className="text-xs text-gray-500">点赞</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_comments))}</div>
                              <div className="text-xs text-gray-500">评论</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_shares))}</div>
                              <div className="text-xs text-gray-500">分享</div>
                            </div>
                          </>
                        )}
                        {/* 图文：阅读、点赞、评论 */}
                        {selectedForm === '图文' && (
                          <>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_views))}</div>
                              <div className="text-xs text-gray-500">阅读</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_likes))}</div>
                              <div className="text-xs text-gray-500">点赞</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_comments))}</div>
                              <div className="text-xs text-gray-500">评论</div>
                            </div>
                          </>
                        )}
                        {/* 长文：阅读、点赞、评论、收藏 */}
                        {selectedForm === '长文' && (
                          <>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_views))}</div>
                              <div className="text-xs text-gray-500">阅读</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_likes))}</div>
                              <div className="text-xs text-gray-500">点赞</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{formatNumber(parseInt(content.total_favorites || '0'))}</div>
                              <div className="text-xs text-gray-500">收藏</div>
                            </div>
                          </>
                        )}
                        {hasMultiplePlatforms && (
                          <div className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            ▼
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 展开的平台明细 */}
                    {isExpanded && hasMultiplePlatforms && (
                      <div className="border-t border-gray-100 bg-gray-50">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">平台</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">{selectedForm === '视频' ? '播放' : '阅读'}</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">点赞</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">评论</th>
                              <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">{selectedForm === '长文' ? '收藏' : '分享'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {content.items.map((item) => {
                              const pInfo = platformNames[item.platform] || { name: item.platform, bg: 'bg-gray-200', text: 'text-gray-700' };
                              return (
                                <tr key={item.id} className="bg-white">
                                  <td className="px-4 py-2">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${pInfo.bg} ${pInfo.text}`}>
                                      {pInfo.name}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right font-medium">{formatNumber(item.views)}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">{formatNumber(item.likes)}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">{formatNumber(item.comments)}</td>
                                  <td className="px-4 py-2 text-right text-gray-600">
                                    {formatNumber(selectedForm === '长文' ? (item.favorites || 0) : item.shares)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 分页控制 */}
          {groupedData?.pagination && groupedData.pagination.total_pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                上一页
              </button>
              <span className="text-sm text-gray-500">
                第 {currentPage} / {groupedData.pagination.total_pages} 页
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(groupedData.pagination.total_pages, p + 1))}
                disabled={currentPage === groupedData.pagination.total_pages}
                className="px-3 py-1 rounded border border-gray-300 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {/* 内容列表 */}
      {viewMode === 'list' && (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700/50 border-b border-gray-200 dark:border-slate-600">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">平台</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">内容</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">类型</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">播放量</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">点赞</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">评论</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">分享</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">收藏</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">涨粉</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">发布时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    加载中...
                  </td>
                </tr>
              ) : contents.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-500">
                    暂无数据，请先运行数据采集
                  </td>
                </tr>
              ) : (
                contents.map((item) => {
                  // 平台名称映射
                  const platformNames: Record<string, { name: string; bg: string; text: string }> = {
                    douyin: { name: '抖音', bg: 'bg-gray-900', text: 'text-white' },
                    kuaishou: { name: '快手', bg: 'bg-orange-500', text: 'text-white' },
                    xiaohongshu: { name: '小红书', bg: 'bg-red-500', text: 'text-white' },
                    toutiao: { name: '头条', bg: 'bg-red-600', text: 'text-white' },
                    weibo: { name: '微博', bg: 'bg-orange-400', text: 'text-white' },
                    channels: { name: '视频号', bg: 'bg-green-500', text: 'text-white' },
                  };
                  const pInfo = platformNames[item.platform] || { name: item.platform, bg: 'bg-gray-200', text: 'text-gray-700' };

                  return (
                  <tr
                    key={item.id}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedItem(item)}
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${pInfo.bg} ${pInfo.text}`}>
                        {pInfo.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        <p className="text-sm font-medium text-gray-900 truncate" title={item.title}>
                          {item.title?.substring(0, 50) || '-'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        item.content_type === '视频' ? 'bg-blue-100 text-blue-700' :
                        item.content_type === '图文' ? 'bg-orange-100 text-orange-700' :
                        item.content_type === '微头条' ? 'bg-purple-100 text-purple-700' :
                        item.content_type === '文章' ? 'bg-green-100 text-green-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {item.content_type === '视频' ? <Video className="w-3 h-3 mr-1" /> : <Image className="w-3 h-3 mr-1" />}
                        {item.content_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900">
                      {formatNumber(item.latest_views || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-900">
                      {item.latest_likes || 0}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {item.latest_comments || 0}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {item.latest_shares || 0}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {item.latest_favorites || 0}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500">
                      {item.latest_follower_gain || 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {item.publish_time ? new Date(item.publish_time).toLocaleDateString('zh-CN') : '-'}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
