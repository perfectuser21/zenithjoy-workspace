/**
 * wechat-cs-daily-report.api 客户端单测：mock apiClient，验证 GET /wechat/cs/daily-report 带 date 参数 + 解 reports 数组。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../client', () => ({
  apiClient: { get: mockGet },
}));

import { wechatCsDailyReportApi } from '../wechat-cs-daily-report.api';

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: { ok: true, date: '2026-06-20', reports: [] } });
});

describe('wechatCsDailyReportApi.getReports', () => {
  it('GET /wechat/cs/daily-report 带 date 参数，返回 reports 数组', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ok: true,
        date: '2026-06-20',
        reports: [
          { cs_wechat_id: 'wxid_a', report_date: '2026-06-20', received_count: 15, reply_count: 11, served_customers: 6, work_duration_minutes: 210, summary_text: '今日接待 6 位客户。' },
        ],
      },
    });
    const rows = await wechatCsDailyReportApi.getReports('2026-06-20');
    expect(mockGet).toHaveBeenCalledWith('/wechat/cs/daily-report', { params: { date: '2026-06-20' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].cs_wechat_id).toBe('wxid_a');
    expect(rows[0].received_count).toBe(15);
    expect(rows[0].summary_text).toContain('接待 6 位客户');
  });

  it('响应缺 reports → 返回空数组（不崩）', async () => {
    mockGet.mockResolvedValueOnce({ data: { ok: true, date: '2026-06-20' } });
    const rows = await wechatCsDailyReportApi.getReports('2026-06-20');
    expect(rows).toEqual([]);
  });
});
