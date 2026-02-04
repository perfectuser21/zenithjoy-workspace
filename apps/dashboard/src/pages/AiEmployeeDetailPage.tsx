import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Briefcase,
  TrendingUp,
} from 'lucide-react';
import { DynamicIcon } from '../components/DynamicIcon';
import {
  getEmployeeById,
  getDepartmentByEmployeeId,
} from '../config/ai-employees.config';
import {
  fetchEmployeeTasks,
  type EmployeeTask,
} from '../api/ai-employees.api';

export default function AiEmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 获取员工和部门信息
  const employee = employeeId ? getEmployeeById(employeeId) : null;
  const department = employeeId ? getDepartmentByEmployeeId(employeeId) : null;

  // 加载任务数据
  const loadData = async () => {
    if (!employeeId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchEmployeeTasks(employeeId);
      setTasks(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError('加载任务数据失败，请稍后重试');
      console.error('Failed to load employee tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // 每 30 秒自动刷新
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [employeeId]);

  // 员工不存在
  if (!employee) {
    return (
      <div className="px-4 sm:px-0 pb-8">
        <div className="text-center py-20">
          <p className="text-slate-500 dark:text-slate-400 mb-4">员工不存在</p>
          <button
            onClick={() => navigate('/ai-employees')}
            className="px-4 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
          >
            返回员工列表
          </button>
        </div>
      </div>
    );
  }

  // 计算今日统计
  const todayStats = {
    total: tasks.length,
    success: tasks.filter(t => t.status === 'success').length,
    error: tasks.filter(t => t.status === 'error').length,
    running: tasks.filter(t => t.status === 'running' || t.status === 'waiting').length,
    successRate: tasks.length > 0
      ? Math.round((tasks.filter(t => t.status === 'success').length / tasks.length) * 100)
      : 0,
  };

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/ai-employees')}
        className="flex items-center gap-2 mb-6 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        返回员工列表
      </button>

      {/* 员工信息卡片 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            {/* 员工图标 */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 flex items-center justify-center shadow-inner">
              <DynamicIcon name={employee.icon} className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            {/* 名称和角色 */}
            <div>
              <h1 className="text-2xl font-semibold text-slate-800 dark:text-white mb-1">
                {employee.name}
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mb-1">
                {employee.role}
              </p>
              {department && (
                <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500">
                  <DynamicIcon name={department.icon} className="w-4 h-4" />
                  {department.name}
                </div>
              )}
            </div>
          </div>

          {/* 刷新按钮 */}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 员工描述 */}
        {employee.description && (
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            {employee.description}
          </p>
        )}

        {/* 职能列表 */}
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            职能范围
          </h3>
          <div className="flex flex-wrap gap-2">
            {employee.abilities.map(ability => (
              <button
                key={ability.id}
                onClick={() => navigate(`/ai-employees/${employee.id}/abilities/${ability.id}`)}
                className="text-sm px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                title={ability.description}
              >
                {ability.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 今日任务统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="今日任务"
          value={todayStats.total}
          color="blue"
        />
        <StatCard
          icon={<CheckCircle className="w-5 h-5" />}
          label="成功"
          value={todayStats.success}
          color="green"
        />
        <StatCard
          icon={<XCircle className="w-5 h-5" />}
          label="失败"
          value={todayStats.error}
          color="red"
        />
        <StatCard
          icon={<Loader2 className="w-5 h-5" />}
          label="成功率"
          value={`${todayStats.successRate}%`}
          color="blue"
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* 最近任务列表 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-white">
            最近任务
          </h2>
          {lastRefresh && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              最后更新: {lastRefresh.toLocaleTimeString('zh-CN')}
            </p>
          )}
        </div>

        {/* 加载状态 */}
        {loading && tasks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-slate-500 dark:text-slate-400">加载中...</p>
            </div>
          </div>
        )}

        {/* 任务列表 */}
        {!loading || tasks.length > 0 ? (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {tasks.length > 0 ? (
              tasks.map(task => (
                <TaskListItem key={task.id} task={task} />
              ))
            ) : (
              <div className="px-6 py-12 text-center">
                <Clock className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 dark:text-slate-500">今日暂无任务记录</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 统计卡片组件
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: 'blue' | 'green' | 'red';
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  };

  return (
    <div className={`${colorClasses[color]} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

// 任务列表项组件
function TaskListItem({ task }: { task: EmployeeTask }) {
  const getStatusIcon = () => {
    switch (task.status) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
      case 'waiting':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-slate-400" />;
    }
  };

  const getStatusText = () => {
    switch (task.status) {
      case 'success':
        return '成功';
      case 'error':
        return '失败';
      case 'running':
        return '运行中';
      case 'waiting':
        return '等待中';
      default:
        return '未知';
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDuration = () => {
    if (!task.stoppedAt) return null;
    const start = new Date(task.startedAt).getTime();
    const end = new Date(task.stoppedAt).getTime();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分${seconds % 60}秒`;
    const hours = Math.floor(minutes / 60);
    return `${hours}小时${minutes % 60}分`;
  };

  return (
    <div className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
      <div className="flex items-start gap-4">
        {/* 状态图标 */}
        <div className="mt-1">{getStatusIcon()}</div>

        {/* 任务信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-medium text-slate-800 dark:text-white truncate">
                {task.workflowName || task.abilityName}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {task.abilityName}
              </p>
            </div>
            <span className="text-sm text-slate-400 dark:text-slate-500 whitespace-nowrap">
              {formatTime(task.startedAt)}
            </span>
          </div>

          {/* 状态和时长 */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-400">
              状态: <span className="font-medium">{getStatusText()}</span>
            </span>
            {getDuration() && (
              <>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <span className="text-slate-600 dark:text-slate-400">
                  耗时: <span className="font-medium">{getDuration()}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
