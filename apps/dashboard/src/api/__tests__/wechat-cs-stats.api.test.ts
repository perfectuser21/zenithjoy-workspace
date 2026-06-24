/**
 * wechat-cs-stats.api 客户端单测：mock apiClient，验证 GET /wechat/cs/stats 带 date 参数 + 解 stats 数组。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('../client', () => ({
  apiClient: { get: mockGet },
}));

import { wechatCsStatsApi } from '../wechat-cs-stats.api';

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: { ok: true, date: 'today', stats: [] } });
});

describe('wechatCsStatsApi.getStats', () => {
  it('GET /wechat/cs/stats 带 date 参数，返回 stats 数组', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ok: true,
        date: 'today',
        stats: [
          { cs_wechat_id: 'wxid_a', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
        ],
      },
    });
    const rows = await wechatCsStatsApi.getStats('today');
    expect(mockGet).toHaveBeenCalledWith('/wechat/cs/stats', { params: { date: 'today' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].cs_wechat_id).toBe('wxid_a');
    expect(rows[0].received_count).toBe(3);
  });

  it('yesterday 透传到 params.date', async () => {
    mockGet.mockResolvedValueOnce({ data: { ok: true, date: 'yesterday', stats: [] } });
    await wechatCsStatsApi.getStats('yesterday');
    expect(mockGet).toHaveBeenCalledWith('/wechat/cs/stats', { params: { date: 'yesterday' } });
  });

  it('响应缺 stats → 返回空数组（不崩）', async () => {
    mockGet.mockResolvedValueOnce({ data: { ok: true, date: 'today' } });
    const rows = await wechatCsStatsApi.getStats('today');
    expect(rows).toEqual([]);
  });
});
