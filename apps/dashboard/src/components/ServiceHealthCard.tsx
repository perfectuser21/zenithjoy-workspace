import { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, RefreshCw, ChevronDown, ChevronUp, Clock, Globe, Info, History, BarChart3 } from 'lucide-react';
import type { ServiceHealth, HealthCheckRecord } from '@/api';

// Service metadata - description and endpoint info
const SERVICE_INFO: Record<string, { description: string; endpoint: string }> = {
  brain: {
    description: 'Brain API 服务，提供决策引擎和状态管理功能',
    endpoint: '/api/brain',
  },
  workspace: {
    description: '工作区服务，管理项目配置和文件系统',
    endpoint: '/api/workspace',
  },
  quality: {
    description: '质量监控服务，负责代码审计和自动化测试',
    endpoint: '/api/quality',
  },
  n8n: {
    description: 'N8N 工作流自动化引擎，处理任务调度',
    endpoint: 'http://localhost:5679',
  },
};

interface ServiceHealthCardProps {
  name: string;
  label: string;
  service: ServiceHealth;
  history?: HealthCheckRecord[];
  onRefresh?: () => Promise<void>;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '未知';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 0) return '刚刚';
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}天前`;
}

function formatAbsoluteTime(isoString: string | null): string {
  if (!isoString) return '未知';
  return new Date(isoString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Health check statistics component
function HealthCheckStats({ history }: { history: HealthCheckRecord[] }) {
  const stats = useMemo(() => {
    if (history.length < 2) {
      return null;
    }

    const healthyCount = history.filter(r => r.status === 'healthy').length;
    const totalCount = history.length;
    const uptime = (healthyCount / totalCount) * 100;

    const latencies = history
      .filter(r => r.latency_ms !== null)
      .map(r => r.latency_ms as number);

    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null;

    return {
      uptime: uptime.toFixed(1),
      avgLatency: avgLatency !== null ? Math.round(avgLatency) : null,
      totalChecks: totalCount,
    };
  }, [history]);

  if (!stats) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/50">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 className="w-3 h-3 text-gray-400" />
          <span className="text-gray-500 font-medium">统计摘要</span>
        </div>
        <div className="text-xs text-gray-400 italic">数据不足（需要至少 2 条记录）</div>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/50">
      <div className="flex items-center gap-1.5 mb-2">
        <BarChart3 className="w-3 h-3 text-gray-400" />
        <span className="text-gray-500 font-medium">统计摘要</span>
        <span className="text-gray-400 text-xs">（{stats.totalChecks} 次检查）</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
          <div className="text-xs text-gray-500 mb-0.5">可用率</div>
          <div className={`text-sm font-semibold ${
            parseFloat(stats.uptime) >= 99 ? 'text-green-600 dark:text-green-400' :
            parseFloat(stats.uptime) >= 95 ? 'text-amber-600 dark:text-amber-400' :
            'text-red-600 dark:text-red-400'
          }`}>
            {stats.uptime}%
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2">
          <div className="text-xs text-gray-500 mb-0.5">平均延迟</div>
          {stats.avgLatency !== null ? (
            <div className={`text-sm font-semibold ${
              stats.avgLatency < 100 ? 'text-green-600 dark:text-green-400' :
              stats.avgLatency < 500 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {stats.avgLatency}ms
            </div>
          ) : (
            <div className="text-sm text-gray-400">N/A</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ServiceHealthCard({ name, label, service, history, onRefresh }: ServiceHealthCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRefresh || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const isHealthy = service.status === 'healthy';

  const serviceInfo = SERVICE_INFO[name];

  return (
    <div
      className={`rounded-lg border transition-all duration-200 cursor-pointer ${
        isHealthy
          ? 'border-green-200 bg-green-50 hover:bg-green-100/80 dark:border-green-800 dark:bg-green-900/20 dark:hover:bg-green-900/30'
          : 'border-red-200 bg-red-50 hover:bg-red-100/80 dark:border-red-800 dark:bg-red-900/20 dark:hover:bg-red-900/30'
      } ${isExpanded ? 'ring-2 ring-offset-1' : 'hover:shadow-sm'} ${
        isHealthy
          ? isExpanded ? 'ring-green-300 dark:ring-green-700' : ''
          : isExpanded ? 'ring-red-300 dark:ring-red-700' : ''
      }`}
    >
      {/* Header - Clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 text-left"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
          </span>
          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={`p-1 rounded hover:bg-white/50 dark:hover:bg-black/20 transition-colors ${
                  isRefreshing ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="刷新健康状态"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
            {isHealthy ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            )}
          </div>
        </div>

        {/* Basic Info */}
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
          {service.latency_ms !== null ? (
            <div className="flex items-center gap-1">
              <span>延迟:</span>
              <span className={`font-medium ${
                service.latency_ms < 100 ? 'text-green-600 dark:text-green-400' :
                service.latency_ms < 500 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400'
              }`}>
                {service.latency_ms}ms
              </span>
            </div>
          ) : (
            <div className="text-red-500">{service.error || '不可用'}</div>
          )}
          <div
            className="flex items-center gap-1 text-gray-400 cursor-help"
            title={formatAbsoluteTime(service.last_check)}
          >
            <Clock className="w-3 h-3" />
            <span>{formatRelativeTime(service.last_check)}</span>
          </div>
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-200/50 dark:border-gray-700/50">
          <div className="mt-3 space-y-2 text-xs">
            {/* Service Key */}
            <div className="flex justify-between">
              <span className="text-gray-500">服务标识:</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">{name}</span>
            </div>

            {/* Status */}
            <div className="flex justify-between">
              <span className="text-gray-500">状态:</span>
              <span className={`font-medium ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                {isHealthy ? '健康' : '异常'}
              </span>
            </div>

            {/* Latency with color coding */}
            {service.latency_ms !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500">响应延迟:</span>
                <span className={`font-medium ${
                  service.latency_ms < 100 ? 'text-green-600' :
                  service.latency_ms < 500 ? 'text-amber-600' :
                  'text-red-600'
                }`}>
                  {service.latency_ms}ms
                  {service.latency_ms < 100 && ' (优秀)'}
                  {service.latency_ms >= 100 && service.latency_ms < 500 && ' (正常)'}
                  {service.latency_ms >= 500 && ' (较慢)'}
                </span>
              </div>
            )}

            {/* Last Check Time - Full timestamp */}
            <div className="flex justify-between">
              <span className="text-gray-500">检查时间:</span>
              <span className="text-gray-700 dark:text-gray-300">
                {service.last_check
                  ? new Date(service.last_check).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })
                  : '未知'
                }
              </span>
            </div>

            {/* Service Description */}
            {serviceInfo && (
              <div className="mt-2 pt-2 border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-start gap-1.5">
                  <Info className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600 dark:text-gray-400">{serviceInfo.description}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Globe className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <code className="text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs">
                    {serviceInfo.endpoint}
                  </code>
                </div>
              </div>
            )}

            {/* Error Details */}
            {service.error && (
              <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-red-700 dark:text-red-300">
                <div className="font-medium mb-1">错误详情:</div>
                <div className="font-mono text-xs break-all">{service.error}</div>
              </div>
            )}

            {/* Health Check Statistics */}
            {history && history.length > 0 && (
              <HealthCheckStats history={history} />
            )}

            {/* Health Check History */}
            {history && history.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200/50 dark:border-gray-700/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <History className="w-3 h-3 text-gray-400" />
                    <span className="text-gray-500 font-medium">健康检查历史</span>
                  </div>
                  {/* Uptime Percentage */}
                  {(() => {
                    const healthyCount = history.filter(r => r.status === 'healthy').length;
                    const uptimePercent = (healthyCount / history.length) * 100;
                    return (
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        uptimePercent >= 99 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        uptimePercent >= 95 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {uptimePercent.toFixed(0)}% 可用
                      </span>
                    );
                  })()}
                </div>
                <div className="space-y-1.5">
                  {history.slice(0, 5).map((record, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between p-2 rounded ${
                        record.status === 'healthy'
                          ? 'bg-green-50 dark:bg-green-900/20'
                          : 'bg-red-50 dark:bg-red-900/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {record.status === 'healthy' ? (
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-500" />
                        )}
                        <span className={`text-xs font-medium ${
                          record.status === 'healthy' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                        }`}>
                          {record.status === 'healthy' ? '健康' : '异常'}
                        </span>
                        {record.latency_ms !== null && (
                          <span className={`text-xs ${
                            record.latency_ms < 100 ? 'text-green-600 dark:text-green-400' :
                            record.latency_ms < 500 ? 'text-amber-600 dark:text-amber-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                            {record.latency_ms}ms
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(record.timestamp).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
                {history.length > 5 && (
                  <div className="mt-1.5 text-xs text-gray-400 text-center">
                    显示最近 5 条，共 {history.length} 条记录
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
