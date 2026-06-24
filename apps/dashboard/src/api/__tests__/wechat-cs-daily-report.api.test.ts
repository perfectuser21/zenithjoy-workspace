import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock apiClient（axios 封装）—— 钉死 GET /wechat/cs/daily-report 带 date 参数 + 解出 reports 数组。
vi.mock('../client', () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from '../client';
import { wechatCsDailyReportApi } from '../wechat-cs-daily-report.api';

const mockedGet = vi.mocked((apiClient as { get: ReturnType<typeof vi.fn> }).get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wechatCsDailyReportApi.getReports', () => {
  it('GET /wechat/cs/daily-report 带 date 参数，返回 reports 数组', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        ok: true,
        date: '2026-06-20',
        reports: [
          { cs_wechat_id: 'wxid_a', report_date: '2026-06-20', received_count: 15, reply_count: 11, served_customers: 6, work_duration_minutes: 210, summary_text: '今日接待 6 位客户。' },
        ],
      },
    });
    const rows = await wechatCsDailyReportApi.getReports('2026-06-20');
    const [url, cfg] = mockedGet.mock.calls[0];
    expect(url).toBe('/wechat/cs/daily-report');
    expect((cfg as { params: { date: string } }).params.date).toBe('2026-06-20');
    expect(rows).toHaveLength(1);
    expect(rows[0].cs_wechat_id).toBe('wxid_a');
    expect(rows[0].received_count).toBe(15);
    expect(rows[0].summary_text).toContain('接待 6 位客户');
  });

  it('响应缺 reports → 返回空数组（不崩）', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true, date: '2026-06-20' } });
    const rows = await wechatCsDailyReportApi.getReports('2026-06-20');
    expect(rows).toEqual([]);
  });
});
