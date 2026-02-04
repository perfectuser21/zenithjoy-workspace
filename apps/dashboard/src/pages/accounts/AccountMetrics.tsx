import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Calendar, TrendingUp, Eye, Heart } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { MetricCard } from '../../components/MetricCard';
import type { AccountMetrics as AccountMetricsType } from '../../api/accounts.api';
import { accountsApi } from '../../api/accounts.api';

export default function AccountMetrics() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<AccountMetricsType | null>(null);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'all'>('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadMetrics();
    }
  }, [id, timeRange]);

  const loadMetrics = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const now = new Date();
      let startDate: string | undefined;

      if (timeRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        startDate = weekAgo.toISOString().split('T')[0];
      } else if (timeRange === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        startDate = monthAgo.toISOString().split('T')[0];
      }

      const data = await accountsApi.getAccountMetrics(id, startDate);
      setMetrics(data);
    } catch (error) {
      console.error('Failed to load metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!id) return;

    try {
      const blob = await accountsApi.exportAccountData(id, 'csv');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `account-${id}-metrics-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export data:', error);
      alert('导出失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">暂无数据</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/accounts')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{metrics.displayName}</h1>
            <p className="text-gray-500 mt-1">{metrics.platform} - {metrics.accountId}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
            <button
              onClick={() => setTimeRange('week')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              近7天
            </button>
            <button
              onClick={() => setTimeRange('month')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              近30天
            </button>
            <button
              onClick={() => setTimeRange('all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              全部
            </button>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            导出数据
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="粉丝总数"
          value={metrics.followers.total.toLocaleString()}
          change={metrics.followers.delta}
          changeLabel="增长"
          icon={TrendingUp}
          iconColor="text-blue-600"
          iconBgColor="bg-blue-100"
        />
        <MetricCard
          title="总曝光量"
          value={metrics.impressions.total.toLocaleString()}
          icon={Eye}
          iconColor="text-purple-600"
          iconBgColor="bg-purple-100"
        />
        <MetricCard
          title="总互动量"
          value={metrics.engagement.total.toLocaleString()}
          icon={Heart}
          iconColor="text-pink-600"
          iconBgColor="bg-pink-100"
        />
        <MetricCard
          title="平均互动率"
          value={`${metrics.engagement.averageRate.toFixed(2)}%`}
          icon={TrendingUp}
          iconColor="text-green-600"
          iconBgColor="bg-green-100"
        />
      </div>

      {/* Followers Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">粉丝增长趋势</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={metrics.followers.trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: '#3b82f6', r: 4 }}
              name="粉丝数"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Engagement Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">互动趋势</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={metrics.engagement.trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#ec4899"
              strokeWidth={2}
              dot={{ fill: '#ec4899', r: 4 }}
              name="互动量"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Top Performing Posts */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">优质内容</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  标题
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  互动量
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  曝光量
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  发布时间
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {metrics.content.topPerformingPosts.map(post => (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline line-clamp-1"
                    >
                      {post.title}
                    </a>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900">
                      {post.engagement.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">
                      {post.impressions.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(post.publishedAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
