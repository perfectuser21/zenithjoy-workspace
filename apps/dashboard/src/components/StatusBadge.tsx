import React from 'react';
import { CheckCircle, XCircle, Clock, AlertCircle, Pause } from 'lucide-react';

interface StatusBadgeProps {
  status: 'success' | 'failed' | 'running' | 'waiting' | 'paused' | 'active' | 'error' | 'valid' | 'expired' | 'unknown';
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, text, size = 'md' }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'success':
      case 'active':
      case 'valid':
        return {
          icon: CheckCircle,
          text: text || '成功',
          bgColor: 'bg-green-50',
          textColor: 'text-green-700',
          iconColor: 'text-green-500',
          borderColor: 'border-green-200'
        };
      case 'failed':
      case 'error':
      case 'expired':
        return {
          icon: XCircle,
          text: text || '失败',
          bgColor: 'bg-red-50',
          textColor: 'text-red-700',
          iconColor: 'text-red-500',
          borderColor: 'border-red-200'
        };
      case 'running':
        return {
          icon: Clock,
          text: text || '运行中',
          bgColor: 'bg-blue-50',
          textColor: 'text-blue-700',
          iconColor: 'text-blue-500',
          borderColor: 'border-blue-200',
          animate: true
        };
      case 'waiting':
        return {
          icon: Clock,
          text: text || '等待中',
          bgColor: 'bg-gray-50',
          textColor: 'text-gray-700',
          iconColor: 'text-gray-500',
          borderColor: 'border-gray-200'
        };
      case 'paused':
        return {
          icon: Pause,
          text: text || '已暂停',
          bgColor: 'bg-yellow-50',
          textColor: 'text-yellow-700',
          iconColor: 'text-yellow-500',
          borderColor: 'border-yellow-200'
        };
      case 'unknown':
      default:
        return {
          icon: AlertCircle,
          text: text || '未知',
          bgColor: 'bg-gray-50',
          textColor: 'text-gray-700',
          iconColor: 'text-gray-500',
          borderColor: 'border-gray-200'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-2.5 py-1.5 text-sm',
    lg: 'px-3 py-2 text-base'
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${config.bgColor} ${config.textColor} ${config.borderColor} ${sizeClasses[size]}`}
    >
      <Icon className={`${iconSizes[size]} ${config.iconColor} ${config.animate ? 'animate-spin' : ''}`} />
      {config.text}
    </span>
  );
};
