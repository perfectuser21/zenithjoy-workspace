import { useState, useEffect } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Eye } from 'lucide-react';

interface RawScrapingData {
  id: number;
  platform: string;
  scraped_at: string;
  raw_text: string;
  raw_html: string | null;
  url: string | null;
  scraper_version: string | null;
  browser_info: any;
  metadata: any;
  processed: boolean;
  processed_at: string | null;
  processing_error: string | null;
  created_at: string;
}

const API_BASE = '';

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

export default function RawScrapingData() {
  const [data, setData] = useState<RawScrapingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<keyof RawScrapingData>('scraped_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterPlatform, setFilterPlatform] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/media/raw-scraping-data`);
      const result = await res.json();
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch raw scraping data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data
    .filter(item => {
      if (filterPlatform && item.platform !== filterPlatform) return false;
      return true;
    })
    .sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (aVal === bVal) return 0;
      const comparison = aVal > bVal ? 1 : -1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  const toggleSort = (field: keyof RawScrapingData) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }: { field: keyof RawScrapingData }) => {
    if (sortBy !== field) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const platforms = Array.from(new Set(data.map(d => d.platform)));

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
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
          <h1 className="text-2xl font-bold text-gray-900">原始抓取数据</h1>
          <p className="text-gray-500 mt-1">raw_scraping_data 表 · 爬虫抓取的最原始数据 · 未经任何处理</p>
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
          <div className="text-sm text-gray-500">总抓取记录</div>
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
          <div className="text-sm text-gray-500">已处理</div>
          <div className="text-2xl font-bold text-green-600">
            {data.filter(d => d.processed).length}
          </div>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700">平台筛选：</span>
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
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('id')}
                    className="flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900"
                  >
                    ID
                    <SortIcon field="id" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('platform')}
                    className="flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900"
                  >
                    平台
                    <SortIcon field="platform" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('scraped_at')}
                    className="flex items-center gap-1 font-medium text-gray-700 hover:text-gray-900"
                  >
                    抓取时间
                    <SortIcon field="scraped_at" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">URL</th>
                <th className="px-4 py-3 text-left">原始文本预览</th>
                <th className="px-4 py-3 text-left">处理状态</th>
                <th className="px-4 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredData.map((item) => (
                <>
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{item.id}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-block px-2 py-1 rounded text-white text-xs font-medium"
                        style={{ backgroundColor: platformConfig[item.platform]?.color || '#999' }}
                      >
                        {platformConfig[item.platform]?.name || item.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">
                      {formatDateTime(item.scraped_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-xs truncate">
                      {item.url || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-md">
                      <div className="truncate">
                        {item.raw_text?.substring(0, 100) || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {item.processed ? (
                        <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                          已处理
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs">
                          未处理
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="text-blue-600 hover:text-blue-700"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 bg-gray-50">
                        <div className="space-y-4">
                          {/* 原始文本 */}
                          <div>
                            <div className="text-xs font-medium text-gray-700 mb-2">原始文本 (raw_text):</div>
                            <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto whitespace-pre-wrap max-h-96">
                              {item.raw_text}
                            </pre>
                          </div>

                          {/* Metadata */}
                          {item.metadata && Object.keys(item.metadata).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-gray-700 mb-2">元数据 (metadata):</div>
                              <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                                {JSON.stringify(item.metadata, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Browser Info */}
                          {item.browser_info && Object.keys(item.browser_info).length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-gray-700 mb-2">浏览器信息 (browser_info):</div>
                              <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                                {JSON.stringify(item.browser_info, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* 处理信息 */}
                          <div className="grid grid-cols-3 gap-4 text-xs">
                            <div>
                              <span className="text-gray-500">Scraper版本:</span>
                              <span className="ml-2 text-gray-900">{item.scraper_version || '-'}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">处理时间:</span>
                              <span className="ml-2 text-gray-900">
                                {item.processed_at ? formatDateTime(item.processed_at) : '-'}
                              </span>
                            </div>
                            <div>
                              <span className="text-gray-500">创建时间:</span>
                              <span className="ml-2 text-gray-900">{formatDateTime(item.created_at)}</span>
                            </div>
                          </div>

                          {/* 处理错误 */}
                          {item.processing_error && (
                            <div>
                              <div className="text-xs font-medium text-red-600 mb-2">处理错误:</div>
                              <div className="bg-red-50 p-3 rounded border border-red-200 text-xs text-red-700">
                                {item.processing_error}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {filteredData.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            暂无数据
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="text-xs text-gray-500 text-center">
        显示 {filteredData.length} / {data.length} 条记录 · 点击眼睛图标查看完整原始数据
      </div>
    </div>
  );
}
