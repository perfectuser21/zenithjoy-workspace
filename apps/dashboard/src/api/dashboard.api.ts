/**
 * Dashboard API - 聚合 Dashboard 首页所需的实时统计数据
 */

import { apiClient } from './client';
import { accountsApi } from './accounts.api';
import { publishApi } from './publish.api';

// ============ 类型定义 ============

export interface DashboardStats {
  // 今日发布数
  todayPublished: {
    value: number;
    delta: number; // 较昨日变化
  };
  // 待处理任务
  pendingTasks: {
    value: number;
    delta: number;
  };
  // 活跃账号数
  activeAccounts: {
    value: number;
    delta: number;
  };
  // AI 员工执行次数
  aiExecutions: {
    value: number;
    delta: number;
  };
}

// n8n live status 响应类型
interface LiveStatusOverview {
  todayStats: {
    running: number;
    success: number;
    error: number;
    total: number;
  };
  runningExecutions: Array<{
    id: string;
    workflowId: string;
    workflowName: string;
    startedAt: string;
    duration: number;
  }>;
  recentCompleted: Array<{
    id: string;
    workflowId: string;
    workflowName?: string;
    status: string;
    startedAt: string;
    stoppedAt?: string;
  }>;
  timestamp: number;
}

// ============ API 函数 ============

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * 获取 Dashboard 首页统计数据
 *
 * 聚合多个 API 的数据：
 * - 发布统计
 * - 账号状态
 * - AI 员工执行情况
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  try {
    // 并行获取所有数据
    const [publishStats, accounts, liveStatus] = await Promise.all([
      fetchPublishStats(),
      fetchAccountStats(),
      fetchAiExecutionStats(),
    ]);

    return {
      todayPublished: publishStats,
      pendingTasks: {
        value: publishStats.pending,
        delta: 0, // 待处理任务不需要变化值
      },
      activeAccounts: accounts,
      aiExecutions: liveStatus,
    };
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error);
    // 返回默认值
    return {
      todayPublished: { value: 0, delta: 0 },
      pendingTasks: { value: 0, delta: 0 },
      activeAccounts: { value: 0, delta: 0 },
      aiExecutions: { value: 0, delta: 0 },
    };
  }
}

/**
 * 获取发布统计
 */
async function fetchPublishStats(): Promise<{ value: number; delta: number; pending: number }> {
  try {
    const stats = await publishApi.getStats();

    // 今日发布数（completed 状态）
    const todayPublished = stats.byStatus?.completed || 0;

    // 待处理任务
    const pending = (stats.byStatus?.pending || 0) + (stats.byStatus?.draft || 0);

    // 较昨日变化（从 recentTrend 计算）
    let delta = 0;
    if (stats.recentTrend && stats.recentTrend.length >= 2) {
      const today = stats.recentTrend[stats.recentTrend.length - 1];
      const yesterday = stats.recentTrend[stats.recentTrend.length - 2];
      delta = (today?.success || 0) - (yesterday?.success || 0);
    }

    return { value: todayPublished, delta, pending };
  } catch (error) {
    console.error('Failed to fetch publish stats:', error);
    return { value: 0, delta: 0, pending: 0 };
  }
}

/**
 * 获取账号统计
 */
async function fetchAccountStats(): Promise<{ value: number; delta: number }> {
  try {
    const accounts = await accountsApi.getAccounts();

    // 活跃账号数
    const activeCount = accounts.filter(a => a.isActive && a.loginStatus === 'valid').length;

    // 账号变化暂时不追踪，返回 0
    return { value: activeCount, delta: 0 };
  } catch (error) {
    console.error('Failed to fetch account stats:', error);
    return { value: 0, delta: 0 };
  }
}

/**
 * 获取 AI 员工执行统计
 */
async function fetchAiExecutionStats(): Promise<{ value: number; delta: number }> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/n8n-live-status/instances/local/overview`);
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const liveStatus: LiveStatusOverview = await response.json();

    // 今日执行总数
    const todayTotal = liveStatus.todayStats?.total || 0;

    // 变化值暂时不追踪
    return { value: todayTotal, delta: 0 };
  } catch (error) {
    console.error('Failed to fetch AI execution stats:', error);
    return { value: 0, delta: 0 };
  }
}

// ============ 导出 ============

export const dashboardApi = {
  fetchDashboardStats,
};

export default dashboardApi;
