/**
 * AI 员工 API - 按员工视角展示任务统计
 */

import type {
  AiEmployee,
  Department} from '../config/ai-employees.config';
import {
  AI_DEPARTMENTS,
  matchAbilityByWorkflow,
} from '../config/ai-employees.config';

// ============ 类型定义 ============

// 执行记录（简化版）
interface Execution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'crashed';
  startedAt: string;
  stoppedAt?: string;
}

// 今日统计
interface TodayStats {
  running: number;
  success: number;
  error: number;
  total: number;
}

// Live Status Overview
interface LiveStatusOverview {
  todayStats: TodayStats;
  runningExecutions: Array<{
    id: string;
    workflowId: string;
    workflowName: string;
    startedAt: string;
    duration: number;
  }>;
  recentCompleted: Execution[];
  timestamp: number;
}

// 员工任务统计
export interface EmployeeTaskStats {
  todayTotal: number;
  todaySuccess: number;
  todayError: number;
  todayRunning: number;
  successRate: number;
  recentTasks: EmployeeTask[];
}

// 员工任务
export interface EmployeeTask {
  id: string;
  workflowId: string;
  workflowName: string;
  abilityId: string;
  abilityName: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
}

// 带统计的员工
export interface AiEmployeeWithStats extends AiEmployee {
  stats: EmployeeTaskStats;
}

// 带统计的部门
export interface DepartmentWithStats extends Department {
  employees: AiEmployeeWithStats[];
  todayTotal: number;
}

// ============ API 函数 ============

async function fetchLiveStatus(): Promise<LiveStatusOverview> {
  return {
    todayStats: { running: 0, success: 0, error: 0, total: 0 },
    runningExecutions: [],
    recentCompleted: [],
    timestamp: Date.now(),
  };
}

/**
 * 将执行记录映射到员工任务
 */
function mapExecutionToTask(execution: Execution): EmployeeTask | null {
  const workflowName = execution.workflowName || '';
  const match = matchAbilityByWorkflow(workflowName);

  if (!match) return null;

  return {
    id: execution.id,
    workflowId: execution.workflowId,
    workflowName,
    abilityId: match.ability.id,
    abilityName: match.ability.name,
    status: execution.status === 'crashed' ? 'error' : execution.status,
    startedAt: execution.startedAt,
    stoppedAt: execution.stoppedAt,
  };
}

/**
 * 创建默认的员工统计数据（无 API 数据时使用）
 */
function createDefaultStats(): EmployeeTaskStats {
  return {
    todayTotal: 0,
    todaySuccess: 0,
    todayError: 0,
    todayRunning: 0,
    successRate: 0,
    recentTasks: [],
  };
}

/**
 * 创建带默认统计的部门数据
 */
function createDefaultDepartments(): DepartmentWithStats[] {
  return AI_DEPARTMENTS.map(dept => ({
    ...dept,
    employees: dept.employees.map(emp => ({
      ...emp,
      stats: createDefaultStats(),
    })),
    todayTotal: 0,
  }));
}

/**
 * 获取所有员工的任务统计
 */
export async function fetchAiEmployeesWithStats(): Promise<DepartmentWithStats[]> {
  try {
    const liveStatus = await fetchLiveStatus();

    // 创建员工统计映射
    const employeeStatsMap = new Map<string, EmployeeTaskStats>();

    // 处理所有执行记录
    const allExecutions: Execution[] = [
      ...liveStatus.runningExecutions.map(r => ({
        id: r.id,
        workflowId: r.workflowId,
        workflowName: r.workflowName,
        status: 'running' as const,
        startedAt: r.startedAt,
      })),
      ...liveStatus.recentCompleted,
    ];

    // 遍历所有员工，为每个员工计算统计
    for (const dept of AI_DEPARTMENTS) {
      for (const employee of dept.employees) {
        const stats: EmployeeTaskStats = {
          todayTotal: 0,
          todaySuccess: 0,
          todayError: 0,
          todayRunning: 0,
          successRate: 0,
          recentTasks: [],
        };

        // 匹配员工的任务
        for (const execution of allExecutions) {
          const task = mapExecutionToTask(execution);
          if (task && employee.abilities.some(a => a.id === task.abilityId)) {
            stats.recentTasks.push(task);
            stats.todayTotal++;

            if (task.status === 'success') {
              stats.todaySuccess++;
            } else if (task.status === 'error') {
              stats.todayError++;
            } else if (task.status === 'running' || task.status === 'waiting') {
              stats.todayRunning++;
            }
          }
        }

        // 计算成功率
        const completedTasks = stats.todaySuccess + stats.todayError;
        stats.successRate = completedTasks > 0
          ? Math.round((stats.todaySuccess / completedTasks) * 100)
          : 0;

        employeeStatsMap.set(employee.id, stats);
      }
    }

    // 构建带统计的部门数据
    return AI_DEPARTMENTS.map(dept => ({
      ...dept,
      employees: dept.employees.map(emp => ({
        ...emp,
        stats: employeeStatsMap.get(emp.id) || createDefaultStats(),
      })),
      todayTotal: dept.employees.reduce(
        (sum, emp) => sum + (employeeStatsMap.get(emp.id)?.todayTotal || 0),
        0
      ),
    }));
  } catch (error) {
    console.error('Failed to fetch AI employees stats:', error);
    // 失败时返回默认数据
    return createDefaultDepartments();
  }
}

/**
 * 获取单个员工的详细任务列表
 */
export async function fetchEmployeeTasks(employeeId: string): Promise<EmployeeTask[]> {
  try {
    const liveStatus = await fetchLiveStatus();

    const allExecutions: Execution[] = [
      ...liveStatus.runningExecutions.map(r => ({
        id: r.id,
        workflowId: r.workflowId,
        workflowName: r.workflowName,
        status: 'running' as const,
        startedAt: r.startedAt,
      })),
      ...liveStatus.recentCompleted,
    ];

    const employee = AI_DEPARTMENTS.flatMap(d => d.employees).find(
      e => e.id === employeeId
    );
    if (!employee) return [];

    const tasks: EmployeeTask[] = [];
    for (const execution of allExecutions) {
      const task = mapExecutionToTask(execution);
      if (task && employee.abilities.some(a => a.id === task.abilityId)) {
        tasks.push(task);
      }
    }

    return tasks;
  } catch (error) {
    console.error('Failed to fetch employee tasks:', error);
    return [];
  }
}

// ============ 导出 ============

export const aiEmployeesApi = {
  fetchAiEmployeesWithStats,
  fetchEmployeeTasks,
};
