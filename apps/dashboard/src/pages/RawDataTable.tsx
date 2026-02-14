import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronUp,
  Search,
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
  latest_comments: number;
  latest_shares: number;
  latest_favorites: number;
  latest_follower_gain: number;
  account_name?: string;
  account_id?: string;
  completion_rate?: number;
  completion_rate_5s?: number;
  click_rate?: number;
  bounce_rate?: number;
  avg_play_duration?: string;
  profile_visits?: number;
  content_type_normalized?: string;
  raw_data_id?: number;
  detection_method?: string;
  content_group_id?: number;
  content_id?: string;
  created_at: string;
  updated_at: string;
}

const API_BASE = '';

// 平台配置
const platformConfig: Record<string, { name: string; color: string }> = {
  douyin: { name: '抖音', color: '#000000' },
  kuaishou: { name: '快手', color: '#FF6600' },
  xiaohongshu: { name: '小红书', color: '#FF2442' },
  toutiao: { name: '今日头条', color: '#D22828' },
  weibo: { name: '微博', color: '#E6162D' },
  channels: { name: '视频号', color: '#07C160' },
  zhihu: { name: '知乎', color: '#0084FF' },
  bilibili: { name: 'B站', color: '#FB7299' },
};

// 所有字段定义（按数据库顺序）
const allFields = [
  { key: 'id', label: 'ID', width: '80px', type: 'id' }, // 不格式化
  { key: 'platform', label: '平台', width: '100px', type: 'text' },
  { key: 'content_type', label: '内容类型', width: '100px', type: 'text' },
  { key: 'title', label: '标题', width: '200px', type: 'text' }, // 缩短宽度
  { key: 'publish_time', label: '发布时间', width: '160px', type: 'datetime' },
  { key: 'status', label: '状态', width: '80px', type: 'text' },
  { key: 'latest_views', label: '播放/阅读', width: '100px', type: 'number' },
  { key: 'latest_likes', label: '点赞', width: '80px', type: 'number' },
  { key: 'latest_comments', label: '评论', width: '80px', type: 'number' },
  { key: 'latest_shares', label: '分享', width: '80px', type: 'number' },
  { key: 'latest_favorites', label: '收藏', width: '80px', type: 'number' },
  { key: 'latest_follower_gain', label: '涨粉', width: '80px', type: 'number' },
  { key: 'completion_rate', label: '完播率%', width: '90px', type: 'percent', platforms: ['douyin', 'kuaishou', 'channels'] },
  { key: 'completion_rate_5s', label: '5s完播%', width: '90px', type: 'percent', platforms: ['douyin', 'kuaishou'] },
  { key: 'click_rate', label: '点击率%', width: '90px', type: 'percent', platforms: ['toutiao', 'weibo'] },
  { key: 'bounce_rate', label: '跳出率%', width: '90px', type: 'percent', platforms: ['toutiao'] },
  { key: 'avg_play_duration', label: '平均时长', width: '100px', type: 'text', platforms: ['douyin', 'kuaishou', 'channels'] },
  { key: 'profile_visits', label: '主页访问', width: '90px', type: 'number', platforms: ['douyin', 'xiaohongshu'] },
  { key: 'account_name', label: '账号名称', width: '120px', type: 'text' },
  { key: 'account_id', label: '账号ID', width: '120px', type: 'text' },
  { key: 'content_type_normalized', label: '类型标准化', width: '100px', type: 'text' },
  { key: 'content_group_id', label: '内容组ID', width: '100px', type: 'number' },
  { key: 'content_id', label: '内容ID', width: '120px', type: 'text' },
  { key: 'raw_data_id', label: '原始数据ID', width: '100px', type: 'number' },
  { key: 'detection_method', label: '检测方法', width: '120px', type: 'text' },
  { key: 'created_at', label: '创建时间', width: '160px', type: 'datetime' },
  { key: 'updated_at', label: '更新时间', width: '160px', type: 'datetime' },
];

const formatNumber = (num: number | string | null | undefined) => {
  if (num === null || num === undefined) return '-';
  const n = typeof num === 'string' ? parseInt(num) : num;
  if (isNaN(n)) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString();
};

const formatDateTime = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('zh-CN');
};

export default function RawDataTable() {
  const [data, setData] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<keyof ContentItem>('publish_time');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/media/platform-data?limit=1000`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  // 筛选和排序
  const filteredData = data
    .filter(item => {
      if (filterPlatform && item.platform !== filterPlatform) return false;
      if (filterType && item.content_type !== filterType) return false;
      if (filterDate && formatDate(item.publish_time) !== filterDate) return false;
      if (searchText && !item.title.toLowerCase().includes(searchText.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === bVal) return 0;
      const comparison = aVal > bVal ? 1 : -1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const toggleSort = (field: keyof ContentItem) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }: { field: keyof ContentItem }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  // 获取所有唯一值
  const platforms = Array.from(new Set(data.map(d => d.platform)));
  const contentTypes = Array.from(new Set(data.map(d => d.content_type)));
  const dates = Array.from(new Set(data.map(d => formatDate(d.publish_time)))).sort((a, b) => b.localeCompare(a));

  // 渲染单元格值
  const renderCellValue = (item: ContentItem, field: typeof allFields[0]) => {
    const value = item[field.key as keyof ContentItem];

    // 检查是否是平台特有字段，如果不适用则显示灰色的 "-"
    if (field.platforms && !field.platforms.includes(item.platform)) {
      return <span className="text-gray-300">-</span>;
    }

    switch (field.type) {
      case 'id':
        return value || '-'; // ID 直接显示原始数字，不格式化
      case 'number':
        return formatNumber(value as number);
      case 'percent':
        return value ? `${value}%` : '-';
      case 'datetime':
        return formatDateTime(value as string);
      case 'text':
      default:
        return value || '-';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">原始数据表</h1>
          <p className="text-gray-500 mt-1">数据库完整导出 · 所有字段横向展开 · 类似 Excel</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">总记录数</div>
          <div className="text-2xl font-bold text-gray-900">{data.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">筛选后</div>
          <div className="text-2xl font-bold text-blue-600">{filteredData.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">平台数</div>
          <div className="text-2xl font-bold text-gray-900">{platforms.length}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm text-gray-500">日期数</div>
          <div className="text-2xl font-bold text-gray-900">{dates.length}</div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">筛选：</span>
          </div>

          {/* 日期筛选 */}
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
          >
            <option value="">全部日期</option>
            {dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* 平台筛选 */}
          <select
            value={filterPlatform}
            onChange={(e) => setFilterPlatform(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部平台</option>
            {platforms.map(p => (
              <option key={p} value={p}>{platformConfig[p]?.name || p}</option>
            ))}
          </select>

          {/* 类型筛选 */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">全部类型</option>
            {contentTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* 搜索标题 */}
          <div className="flex-1 min-w-[200px] max-w-[300px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索标题..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* 清除筛选 */}
          {(filterPlatform || filterType || filterDate || searchText) && (
            <button
              onClick={() => {
                setFilterPlatform('');
                setFilterType('');
                setFilterDate('');
                setSearchText('');
              }}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 字段说明 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
        <div className="font-medium mb-1">💡 字段说明：</div>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li><span className="text-gray-400">灰色 "-"</span> = 该平台不支持此字段（如：小红书没有5s完播率）</li>
          <li><span className="text-gray-900">黑色 "-"</span> = 该字段暂无数据</li>
          <li>完播率、5s完播率：抖音、快手特有</li>
          <li>点击率、跳出率：今日头条特有</li>
          <li>主页访问：抖音、小红书特有</li>
        </ul>
      </div>

      {/* 数据表格 - Excel 风格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[600px]" style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full text-xs border-collapse min-w-max">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                {allFields.map((field) => (
                  <th
                    key={field.key}
                    className="px-2 py-2 text-left border-r border-gray-200 last:border-r-0"
                    style={{ minWidth: field.width }}
                  >
                    <button
                      onClick={() => toggleSort(field.key as keyof ContentItem)}
                      className="flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900 whitespace-nowrap w-full"
                    >
                      {field.label}
                      <SortIcon field={field.key as keyof ContentItem} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((item, idx) => (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                >
                  {allFields.map((field) => (
                    <td
                      key={field.key}
                      className="px-2 py-2 border-r border-gray-200 last:border-r-0 text-gray-900"
                      style={{
                        minWidth: field.width,
                        maxWidth: field.key === 'title' ? field.width : 'none'
                      }}
                    >
                      {field.key === 'platform' ? (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-white text-xs font-medium whitespace-nowrap"
                          style={{ backgroundColor: platformConfig[item.platform]?.color || '#999' }}
                        >
                          {platformConfig[item.platform]?.name || item.platform}
                        </span>
                      ) : field.key === 'title' ? (
                        <div className="truncate overflow-hidden text-ellipsis whitespace-nowrap" title={item.title}>
                          {item.title}
                        </div>
                      ) : (
                        <div className="whitespace-nowrap">
                          {renderCellValue(item, field)}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredData.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            {searchText || filterPlatform || filterType || filterDate ? '没有符合条件的数据' : '暂无数据'}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="text-xs text-gray-500 text-center">
        显示 {filteredData.length} / {data.length} 条记录 · 共 {allFields.length} 个字段 · 可横向滚动查看所有列
      </div>
    </div>
  );
}
