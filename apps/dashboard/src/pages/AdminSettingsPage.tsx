import { Link } from 'react-router-dom';
import { MonitorDot, Server, DollarSign, Workflow, Radio } from 'lucide-react';

const AdminSettingsPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">管理员专区</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link
          to="/settings/claude-monitor"
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
        >
          <MonitorDot className="w-10 h-10 text-purple-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">Claude Monitor</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">监控 Claude 会话运行状态和 Token 使用</p>
        </Link>
        <Link
          to="/settings/vps-monitor"
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
        >
          <Server className="w-10 h-10 text-green-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">VPS 监控</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">监控服务器资源使用和容器状态</p>
        </Link>
        <Link
          to="/settings/claude-stats"
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
        >
          <DollarSign className="w-10 h-10 text-emerald-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">Claude Stats</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">费用统计、Token 使用趋势分析</p>
        </Link>
        <Link
          to="/settings/n8n-workflows"
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
        >
          <Workflow className="w-10 h-10 text-orange-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">N8n 工作流</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">监控自动化工作流执行状态</p>
        </Link>
        <Link
          to="/settings/n8n-status"
          className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
        >
          <Radio className="w-10 h-10 text-green-500 mb-3" />
          <h3 className="font-medium text-gray-900 dark:text-white mb-1">N8n 实时状态</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">实时监控工作流执行、今日统计</p>
        </Link>
      </div>
    </div>
  );
};

export default AdminSettingsPage;
