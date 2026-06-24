import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock apiClient（axios 封装）—— 钉死 GET /wechat/cs/stats 带 date 参数 + 解出 stats 数组。
vi.mock('../client', () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from '../client';
import { wechatCsStatsApi } from '../wechat-cs-stats.api';

const mockedGet = vi.mocked((apiClient as { get: ReturnType<typeof vi.fn> }).get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wechatCsStatsApi.getStats', () => {
  it('GET /wechat/cs/stats 带 date 参数，返回 stats 数组', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        ok: true,
        date: 'today',
        stats: [
          { cs_wechat_id: 'wxid_a', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
        ],
      },
    });
    const rows = await wechatCsStatsApi.getStats('today');
    const [url, cfg] = mockedGet.mock.calls[0];
    expect(url).toBe('/wechat/cs/stats');
    expect((cfg as { params: { date: string } }).params.date).toBe('today');
    expect(rows).toHaveLength(1);
    expect(rows[0].cs_wechat_id).toBe('wxid_a');
    expect(rows[0].received_count).toBe(3);
  });

  it('yesterday 透传到 params.date', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true, date: 'yesterday', stats: [] } });
    await wechatCsStatsApi.getStats('yesterday');
    expect((mockedGet.mock.calls[0][1] as { params: { date: string } }).params.date).toBe('yesterday');
  });

  it('响应缺 stats → 返回空数组（不崩）', async () => {
    mockedGet.mockResolvedValueOnce({ data: { ok: true, date: 'today' } });
    const rows = await wechatCsStatsApi.getStats('today');
    expect(rows).toEqual([]);
  });
});
