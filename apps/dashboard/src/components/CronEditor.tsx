import React, { useState, useEffect } from 'react';
import { Clock, HelpCircle } from 'lucide-react';

interface CronEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export const CronEditor: React.FC<CronEditorProps> = ({ value, onChange }) => {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [customValue, setCustomValue] = useState(value);

  useEffect(() => {
    setCustomValue(value);
  }, [value]);

  const presets = [
    { label: '每小时', value: '0 * * * *', description: '每小时整点执行' },
    { label: '每天早上8点', value: '0 8 * * *', description: '每天早上8:00执行' },
    { label: '每天中午12点', value: '0 12 * * *', description: '每天中午12:00执行' },
    { label: '每天晚上8点', value: '0 20 * * *', description: '每天晚上20:00执行' },
    { label: '每周一早上9点', value: '0 9 * * 1', description: '每周一早上9:00执行' },
    { label: '每月1号', value: '0 0 1 * *', description: '每月1号凌晨执行' },
  ];

  const handlePresetChange = (preset: string) => {
    onChange(preset);
    setCustomValue(preset);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setCustomValue(newValue);
    onChange(newValue);
  };

  const parseCron = (cron: string) => {
    const parts = cron.split(' ');
    if (parts.length !== 5) return '无效的Cron表达式';

    const [minute, hour, day, month, weekday] = parts;
    const descriptions: string[] = [];

    // Minute
    if (minute === '*') descriptions.push('每分钟');
    else if (minute === '0') descriptions.push('整点');
    else descriptions.push(`第${minute}分钟`);

    // Hour
    if (hour === '*') descriptions.push('每小时');
    else descriptions.push(`${hour}点`);

    // Day
    if (day !== '*') descriptions.push(`${day}号`);

    // Month
    if (month !== '*') descriptions.push(`${month}月`);

    // Weekday
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    if (weekday !== '*') {
      const days = weekday.split(',').map(d => `周${weekdays[parseInt(d)]}`);
      descriptions.push(days.join('、'));
    }

    return descriptions.join(' ');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 mb-4">
        <button
          type="button"
          onClick={() => setMode('preset')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            mode === 'preset'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          预设模板
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            mode === 'custom'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          自定义
        </button>
      </div>

      {mode === 'preset' ? (
        <div className="grid grid-cols-2 gap-3">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => handlePresetChange(preset.value)}
              className={`p-4 text-left rounded-lg border-2 transition-all ${
                value === preset.value
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-gray-600" />
                <span className="font-medium text-gray-900">{preset.label}</span>
              </div>
              <p className="text-sm text-gray-500">{preset.description}</p>
              <p className="text-xs font-mono text-gray-400 mt-2">{preset.value}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cron 表达式
            </label>
            <input
              type="text"
              value={customValue}
              onChange={handleCustomChange}
              placeholder="* * * * *"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <HelpCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-900 mb-1">格式说明</p>
                <p className="text-blue-700 mb-2">
                  <code className="bg-blue-100 px-1 py-0.5 rounded">分 时 日 月 周</code>
                </p>
                <p className="text-blue-600 text-xs">
                  示例: <code className="bg-blue-100 px-1 py-0.5 rounded">0 9 * * 1</code> = 每周一早上9点
                </p>
              </div>
            </div>
          </div>
          {customValue && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-sm text-gray-600">
                <span className="font-medium">执行时间:</span> {parseCron(customValue)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
