import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AccountCard } from '../../components/AccountCard';
import type { Account } from '../../api/accounts.api';
import { accountsApi } from '../../api/accounts.api';

type PlatformFilter = 'all' | 'xiaohongshu' | 'douyin' | 'bilibili' | 'weibo';

export default function AccountsList() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState<PlatformFilter>('all');
  const [loading, setLoading] = useState(true);
  const [healthChecking, setHealthChecking] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, [filter]);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      const platform = filter === 'all' ? undefined : filter;
      const data = await accountsApi.getAccounts(platform);
      setAccounts(data);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddAccount = () => {
    const platform = prompt('请选择平台 (xiaohongshu/douyin/bilibili/weibo)');
    if (!platform) return;

    const accountId = prompt('请输入账号ID');
    if (!accountId) return;

    const displayName = prompt('请输入显示名称');
    if (!displayName) return;

    accountsApi.addAccount({ platform, accountId, displayName })
      .then(() => {
        alert('账号添加成功');
        loadAccounts();
      })
      .catch(error => {
        console.error('Failed to add account:', error);
        alert('添加失败');
      });
  };

  const handleLogin = (platform: string, accountId: string) => {
    navigate(`/login/${platform}/${accountId}`);
  };

  const handleViewMetrics = (id: string) => {
    navigate(`/accounts/${id}/metrics`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此账号吗？')) return;

    try {
      await accountsApi.deleteAccount(id);
      alert('账号已删除');
      await loadAccounts();
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert('删除失败');
    }
  };

  const handleHealthCheck = async (id: string) => {
    try {
      await accountsApi.healthCheck(id);
      alert('健康检查已完成');
      await loadAccounts();
    } catch (error) {
      console.error('Failed to health check:', error);
      alert('检查失败');
    }
  };

  const handleBatchHealthCheck = async () => {
    try {
      setHealthChecking(true);
      await accountsApi.batchHealthCheck();
      alert('批量健康检查已完成');
      await loadAccounts();
    } catch (error) {
      console.error('Failed to batch health check:', error);
      alert('检查失败');
    } finally {
      setHealthChecking(false);
    }
  };

  const platformCounts = {
    all: accounts.length,
    xiaohongshu: accounts.filter(a => a.platform === 'xiaohongshu').length,
    douyin: accounts.filter(a => a.platform === 'douyin').length,
    bilibili: accounts.filter(a => a.platform === 'bilibili').length,
    weibo: accounts.filter(a => a.platform === 'weibo').length,
  };

  const filteredAccounts = filter === 'all'
    ? accounts
    : accounts.filter(a => a.platform === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">账号管理</h1>
          <p className="text-gray-500 mt-1">管理所有社交媒体平台账号</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBatchHealthCheck}
            disabled={healthChecking}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${healthChecking ? 'animate-spin' : ''}`} />
            {healthChecking ? '检查中...' : '批量检查'}
          </button>
          <button
            onClick={handleAddAccount}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加账号
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="w-5 h-5 text-gray-400" />
        <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 p-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            全部 ({platformCounts.all})
          </button>
          <button
            onClick={() => setFilter('xiaohongshu')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === 'xiaohongshu'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            小红书 ({platformCounts.xiaohongshu})
          </button>
          <button
            onClick={() => setFilter('douyin')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === 'douyin'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            抖音 ({platformCounts.douyin})
          </button>
          <button
            onClick={() => setFilter('bilibili')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === 'bilibili'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            B站 ({platformCounts.bilibili})
          </button>
          <button
            onClick={() => setFilter('weibo')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              filter === 'weibo'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            微博 ({platformCounts.weibo})
          </button>
        </div>
      </div>

      {/* Accounts Grid */}
      {filteredAccounts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAccounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              onLogin={handleLogin}
              onViewMetrics={handleViewMetrics}
              onDelete={handleDelete}
              onHealthCheck={handleHealthCheck}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
            <Plus className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无账号</h3>
          <p className="text-gray-500 mb-4">点击右上角"添加账号"按钮开始</p>
        </div>
      )}
    </div>
  );
}
