import React from 'react';
import { MoreVertical, RefreshCw, BarChart3, Trash2 } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { Account } from '../api/accounts.api';

interface AccountCardProps {
  account: Account;
  onLogin?: (platform: string, accountId: string) => void;
  onViewMetrics?: (id: string) => void;
  onDelete?: (id: string) => void;
  onHealthCheck?: (id: string) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({
  account,
  onLogin,
  onViewMetrics,
  onDelete,
  onHealthCheck
}) => {
  const getPlatformLabel = (platform: string) => {
    const labels: Record<string, string> = {
      xiaohongshu: '小红书',
      douyin: '抖音',
      bilibili: 'B站',
      weibo: '微博'
    };
    return labels[platform] || platform;
  };

  const getPlatformColor = (platform: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      xiaohongshu: { bg: 'bg-red-100', text: 'text-red-700' },
      douyin: { bg: 'bg-black', text: 'text-white' },
      bilibili: { bg: 'bg-pink-100', text: 'text-pink-700' },
      weibo: { bg: 'bg-orange-100', text: 'text-orange-700' }
    };
    return colors[platform] || { bg: 'bg-gray-100', text: 'text-gray-700' };
  };

  const platformColor = getPlatformColor(account.platform);

  const formatDate = (date?: string) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          {account.avatar ? (
            <img
              src={account.avatar}
              alt={account.displayName}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${platformColor.bg} ${platformColor.text} font-semibold`}>
              {account.displayName.charAt(0)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate mb-1">
              {account.displayName}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${platformColor.bg} ${platformColor.text}`}>
                {getPlatformLabel(account.platform)}
              </span>
              <StatusBadge
                status={account.loginStatus}
                text={account.loginStatus === 'valid' ? '已登录' : '已过期'}
                size="sm"
              />
            </div>
          </div>
        </div>
        <button className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
          <MoreVertical className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      <div className="mb-4 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">账号ID</span>
          <span className="font-mono text-gray-900">{account.accountId}</span>
        </div>
        {account.lastHealthCheck && (
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-gray-500">最后检查</span>
            <span className="text-gray-900">{formatDate(account.lastHealthCheck.checkedAt)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {account.loginStatus !== 'valid' && (
          <button
            onClick={() => onLogin?.(account.platform, account.accountId)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重新登录
          </button>
        )}
        {account.loginStatus === 'valid' && (
          <button
            onClick={() => onHealthCheck?.(account.id)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            检查状态
          </button>
        )}
        <button
          onClick={() => onViewMetrics?.(account.id)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors"
        >
          <BarChart3 className="w-4 h-4" />
          查看数据
        </button>
        <button
          onClick={() => onDelete?.(account.id)}
          className="p-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          title="删除账号"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
