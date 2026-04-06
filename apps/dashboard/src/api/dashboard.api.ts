/**
 * Dashboard API — 从 works / publish_logs 拉取真实数据
 */

import { getWorks } from './works.api';
import type { Work } from './works.api';

// ============ 类型定义 ============

export interface DashboardStats {
  totalWorks: number;       // 作品总数
  publishedWorks: number;   // 已发布总数
  todayGenerated: number;   // 今日生成数
  todayPublished: number;   // 今日发布数
  recentWorks: Work[];      // 最近 6 条作品
}

// ============ 主函数 ============

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD'

  const [allRes, publishedRes, recentRes] = await Promise.all([
    getWorks({ limit: 1 }),
    getWorks({ status: 'published', limit: 1 }),
    getWorks({ limit: 50, sort: 'created_at', order: 'desc' }),
  ]);

  const todayGenerated = recentRes.data.filter(w =>
    w.created_at.startsWith(today)
  ).length;

  const todayPublished = recentRes.data.filter(w =>
    w.first_published_at?.startsWith(today)
  ).length;

  return {
    totalWorks: allRes.total,
    publishedWorks: publishedRes.total,
    todayGenerated,
    todayPublished,
    recentWorks: recentRes.data.slice(0, 6),
  };
}

export const dashboardApi = { fetchDashboardStats };
export default dashboardApi;
