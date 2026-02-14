import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { getEmployeeById } from '../config/ai-employees.config';
import type { EmployeeTask } from '../api/ai-employees.api';
import { fetchEmployeeTasks } from '../api/ai-employees.api';
import type { AiAbility } from '../config/ai-employees.config';

export default function AiAbilityDetailPage() {
  const { employeeId, abilityId } = useParams<{ employeeId: string; abilityId: string }>();
  const navigate = useNavigate();

  const [ability, setAbility] = useState<AiAbility | null>(null);
  const [employeeName, setEmployeeName] = useState<string>('');
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRunEnabled, setAutoRunEnabled] = useState(true); // 静态展示，暂不可操作

  useEffect(() => {
    if (!employeeId || !abilityId) {
      navigate('/ai-employees');
      return;
    }

    // 获取员工和职能信息
    const employee = getEmployeeById(employeeId);
    if (!employee) {
      navigate('/ai-employees');
      return;
    }

    const targetAbility = employee.abilities.find(a => a.id === abilityId);
    if (!targetAbility) {
      navigate(`/ai-employees/${employeeId}`);
      return;
    }

    setEmployeeName(employee.name);
    setAbility(targetAbility);

    // 加载任务数据
    loadTasks();
  }, [employeeId, abilityId, navigate]);

  const loadTasks = async () => {
    if (!employeeId || !abilityId) return;

    setLoading(true);
    try {
      const allTasks = await fetchEmployeeTasks(employeeId);
      // 过滤出该职能的任务
      const abilityTasks = allTasks.filter(task => task.abilityId === abilityId);
      setTasks(abilityTasks);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRun = () => {
    alert('功能开发中');
  };

  const handleBack = () => {
    navigate(`/ai-employees/${employeeId}`);
  };

  if (!ability) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 返回按钮 */}
      <button
        onClick={handleBack}
        className="flex items-center gap-2 mb-6 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        <span>返回 {employeeName}</span>
      </button>

      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-slate-800 dark:text-white mb-2">
          {ability.name}
        </h1>
        {ability.description && (
          <p className="text-slate-500 dark:text-slate-400">
            {ability.description}
          </p>
        )}
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
          所属员工: {employeeName}
        </p>
      </div>

      {/* 控制面板 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm mb-6 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-1">
              自动运行
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              定时自动执行此职能的任务
            </p>
          </div>
          {/* Toggle 开关 - 静态展示 */}
          <button
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              autoRunEnabled
                ? 'bg-blue-600'
                : 'bg-slate-300 dark:bg-slate-600'
            }`}
            disabled
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                autoRunEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 手动运行按钮 */}
        <button
          onClick={handleManualRun}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors"
        >
          <Play className="w-5 h-5" />
          手动运行
        </button>
      </div>

      {/* 最近执行记录 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-white mb-4">
          最近执行记录
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-slate-400 dark:text-slate-500">
            暂无执行记录
          </div>
        ) : (
          <div className="space-y-3">
            {tasks.map(task => (
              <TaskRecord key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 任务记录组件
function TaskRecord({ task }: { task: EmployeeTask }) {
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

  const getStatusColor = () => {
    switch (task.status) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'running':
      case 'waiting':
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600';
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getDuration = () => {
    if (!task.stoppedAt) return null;
    const start = new Date(task.startedAt).getTime();
    const stop = new Date(task.stoppedAt).getTime();
    const durationMs = stop - start;

    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${(durationMs / 60000).toFixed(1)}m`;
  };

  return (
    <div className={`p-4 rounded-xl border ${getStatusColor()}`}>
      <div className="flex items-start gap-3">
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-slate-800 dark:text-white truncate">
              {task.workflowName}
            </h3>
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 ml-2">
              {getStatusText()}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{formatDateTime(task.startedAt)}</span>
            {getDuration() && (
              <>
                <span>·</span>
                <span>耗时 {getDuration()}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
