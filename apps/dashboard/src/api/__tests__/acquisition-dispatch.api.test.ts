/**
 * acquisition-dispatch.api 客户端单测：mock global.fetch，验证信封解析逻辑。
 *
 * fetchDispatchPlan：后端返回 {plan:[...], total:N} 信封，前端必须提取 .plan 数组返回，
 * 而不是把整个对象当 DispatchPlanItem[] 返回（否则 plan.map is not a function 白屏）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchDispatchPlan, fetchCookieHealth } from '../acquisition-dispatch.api';

// jsdom 里 localStorage 存在但某些情况 getItem 不可用，统一 stub 掉
vi.stubGlobal('localStorage', {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
});

const PLAN_ITEM = {
  id: 'assign-1',
  lead_id: 'lead-1',
  nickname: '测试用户',
  relevance_score: 0.85,
  profile_url: 'https://example.com/profile',
  account_label: 'burner-1',
  status: 'queued' as const,
  scheduled_for: '2026-06-28T10:00:00Z',
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('fetchDispatchPlan', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('后端返回 {plan:[...],total:N} 时，函数返回的是数组（不是对象）', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, data: { plan: [PLAN_ITEM], total: 1 } })
    );
    const result = await fetchDispatchPlan();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('assign-1');
  });

  it('返回值等于 data.plan，不是整个 data 对象', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, data: { plan: [PLAN_ITEM], total: 1 } })
    );
    const result = await fetchDispatchPlan();
    // 如果错误地返回了整个 data 对象，result 就会含 plan/total 字段而不是直接是数组元素
    expect(result).not.toHaveProperty('plan');
    expect(result).not.toHaveProperty('total');
  });

  it('data.plan 为空数组时返回 []', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ success: true, data: { plan: [], total: 0 } })
    );
    const result = await fetchDispatchPlan();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe('fetchCookieHealth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('后端返回 status 字段时，health 字段应有值（不为 undefined）', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        success: true,
        data: {
          items: [
            {
              account_label: 'burner-1',
              role: 'burner',
              status: 'healthy',
              bound_at: '2026-06-01T00:00:00Z',
              needs_rescan: false,
            },
          ],
          alert_count: 0,
        },
      })
    );
    const result = await fetchCookieHealth();
    expect(result.items).toHaveLength(1);
    // 页面用 it.health 渲染标签颜色，此字段不能是 undefined
    expect(result.items[0].health).toBe('healthy');
    expect(result.items[0].health).not.toBeUndefined();
  });
});
