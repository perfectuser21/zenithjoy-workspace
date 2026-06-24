/**
 * apps/dashboard/src/api/wechat-cs-daily-report.api.ts — 客服日报（S4）API 客户端
 *
 * 对接后端 GET /api/wechat/cs/daily-report?date=YYYY-MM-DD（回看任意历史日期）。
 * apiClient baseURL 已是 /api，自动带 cookie。
 */
import { apiClient } from './client';

export interface CsDailyReport {
  cs_wechat_id: string;
  report_date: string;
  received_count: number;
  reply_count: number;
  served_customers: number;
  work_duration_minutes: number;
  summary_text: string;
  self_name?: string;
}

export interface CsDailyReportResp {
  ok: boolean;
  date: string;
  reports: CsDailyReport[];
}

export const wechatCsDailyReportApi = {
  getReports: async (date: string): Promise<CsDailyReport[]> => {
    const res = await apiClient.get<CsDailyReportResp>('/wechat/cs/daily-report', {
      params: { date },
    });
    return res.data?.reports ?? [];
  },
};

export const { getReports } = wechatCsDailyReportApi;
