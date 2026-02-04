import React, { useState } from 'react';
import { Terminal, Download, Search, X } from 'lucide-react';

interface LogViewerProps {
  logs: string[];
  title?: string;
  onClose?: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ logs, title = '日志', onClose }) => {
  const [filter, setFilter] = useState('');

  const filteredLogs = logs.filter(log =>
    log.toLowerCase().includes(filter.toLowerCase())
  );

  const handleDownload = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <span className="text-sm text-gray-500">({logs.length} 条)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
              title="下载日志"
            >
              <Download className="w-4 h-4 text-gray-600" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4 text-gray-600" />
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索日志..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-gray-900 p-4">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {filter ? '没有匹配的日志' : '暂无日志'}
          </div>
        ) : (
          <div className="font-mono text-sm space-y-1">
            {filteredLogs.map((log, index) => (
              <div
                key={index}
                className={`py-1 px-2 rounded ${
                  log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                    ? 'text-red-400 bg-red-900/20'
                    : log.toLowerCase().includes('warn')
                    ? 'text-yellow-400 bg-yellow-900/20'
                    : log.toLowerCase().includes('success')
                    ? 'text-green-400 bg-green-900/20'
                    : 'text-gray-300'
                }`}
              >
                <span className="text-gray-500 mr-3">{String(index + 1).padStart(4, '0')}</span>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
