/**
 * credits.api 客户端行为测试 — Task 10 Dashboard 充值页
 *
 * 重点不是"函数存在"，是三条真行为约束：
 *   1. createOrder 只把 tier_id/provider 放进请求体，绝不带任何金额字段——
 *      金额由服务端档位表（RECHARGE_TIERS）决定，客户端参与定价是可篡改的攻击面。
 *   2. 后端 success:false（含业务失败与非 2xx）时 apiFetch 必须抛错，绝不能
 *      悄悄返回 undefined 让调用方拿着 undefined 当正常数据往下走。
 *   3. syncOrder 把订单 id 正确拼进 URL 路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOrder, syncOrder } from '../credits.api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<unknown> | unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch
  );
  return calls;
}

describe('createOrder', () => {
  it('请求体只含 tier_id/provider，不带任何金额字段（防篡改：金额由服务端档位决定）', async () => {
    const calls = stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { orderId: 'o-1', qrCodeUrl: 'mock://qr', amountFen: 50000, credits: 550, expireAt: '2026-09-23T00:00:00.000Z' },
        timestamp: '2026-09-23T00:00:00.000Z',
      }),
    }));

    const result = await createOrder('tier_500', 'wechat');

    expect(result.orderId).toBe('o-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/credits/orders');
    expect(calls[0].init?.method).toBe('POST');

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ tier_id: 'tier_500', provider: 'wechat' });
    // 显式钉死：请求体绝不能出现金额/积分相关 key——那些必须只由服务端响应带回
    for (const forbiddenKey of ['amountFen', 'amount', 'credits', 'price']) {
      expect(body).not.toHaveProperty(forbiddenKey);
    }
  });

  it('后端业务失败（success:false）时抛错，而不是返回 undefined 让调用方拿到脏数据', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: false,
        data: null,
        error: { code: 'INSUFFICIENT_BALANCE_TIER', message: '档位不存在' },
        timestamp: '2026-09-23T00:00:00.000Z',
      }),
    }));

    await expect(createOrder('tier_bad', 'alipay')).rejects.toThrow('INSUFFICIENT_BALANCE_TIER');
  });

  it('HTTP 非 2xx 时同样抛错（不把失败响应原样透给调用方）', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    await expect(createOrder('tier_100', 'wechat')).rejects.toThrow('HTTP_500');
  });
});

describe('syncOrder', () => {
  it('把订单 id 正确拼进 URL（POST /api/credits/orders/:id/sync）', async () => {
    const calls = stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { outcome: 'credited' },
        timestamp: '2026-09-23T00:00:00.000Z',
      }),
    }));

    const result = await syncOrder('order-abc-123');

    expect(result.outcome).toBe('credited');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/credits/orders/order-abc-123/sync');
    expect(calls[0].init?.method).toBe('POST');
  });
});
