import { useState, useEffect } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { DepartmentAccordion } from '../components/DepartmentAccordion';
import type {
  DepartmentWithStats} from '../api/ai-employees.api';
import {
  fetchAiEmployeesWithStats
} from '../api/ai-employees.api';

export default function AiEmployeesPage() {
  const [departments, setDepartments] = useState<DepartmentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAiEmployeesWithStats();
      setDepartments(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError('加载数据失败，请稍后重试');
      console.error('Failed to load AI employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalEmployees = departments.reduce(
    (sum, dept) => sum + dept.employees.length,
    0
  );
  const totalTasks = departments.reduce(
    (sum, dept) => sum + dept.todayTotal,
    0
  );

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              AI 员工
            </h1>
            <p className="text-slate-500 dark:text-slate-400 ml-13">
              公司自动化团队 · {totalEmployees} 名员工 · 今日 {totalTasks} 次任务
            </p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {lastRefresh && (
          <p className="text-xs text-slate-400 dark:text-slate-500 ml-13">
            最后更新: {lastRefresh.toLocaleTimeString('zh-CN')}
          </p>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 加载状态 */}
      {loading && departments.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-slate-500 dark:text-slate-400">加载中...</p>
          </div>
        </div>
      )}

      {/* 部门列表 - 折叠面板形式 */}
      {(!loading || departments.length > 0) && (
        <div className="space-y-3">
          {departments.map((dept, index) => (
            <DepartmentAccordion
              key={dept.id}
              department={dept}
              defaultExpanded={index === 0 && dept.employees.length > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
