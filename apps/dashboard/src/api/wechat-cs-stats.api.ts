/**
 * apps/dashboard/src/api/wechat-cs-stats.api.ts — 客服工作汇总统计（S3）API 客户端
 *
 * 对接后端 GET /api/wechat/cs/stats?date=today|yesterday。
 * apiClient baseURL 已是 /api，自动带 cookie。
 */
import { apiClient } from './client';

export type StatsDate = 'today' | 'yesterday';

export interface CsWorkStat {
  cs_wechat_id: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
  self_name?: string;
  auto_agent_enabled?: boolean;
  online?: boolean;
}

export interface CsWorkStatsResp {
  ok: boolean;
  date: StatsDate;
  stats: CsWorkStat[];
}

export const wechatCsStatsApi = {
  getStats: async (date: StatsDate): Promise<CsWorkStat[]> => {
    const res = await apiClient.get<CsWorkStatsResp>('/wechat/cs/stats', {
      params: { date },
    });
    return res.data?.stats ?? [];
  },
};

export const { getStats } = wechatCsStatsApi;
