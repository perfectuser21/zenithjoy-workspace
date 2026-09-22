import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

const settleMock = vi.fn();
vi.mock('../../../src/services/payment/settlement.service', () => ({
  settleOrder: settleMock,
}));

import {
  createRechargeOrder,
  expireStaleOrders,
  InvalidTierError,
} from '../../../src/services/payment/orders.service';
import { __setProviderForTest } from '../../../src/services/payment/provider-registry';
import { MockProvider } from '../../../src/services/payment/mock.provider';

const db = await import('../../../src/db/connection') as any;
const pool = db.default;
const client = db.__client;

beforeEach(() => {
  pool.query.mockReset();
  client.query.mockReset();
  settleMock.mockReset();
  __setProviderForTest('mock', new MockProvider());
});

describe('createRechargeOrder', () => {
  it('未知档位抛 InvalidTierError（金额由服务端定，不信客户端）', async () => {
    await expect(createRechargeOrder('t-1', 'tier_hacked', 'mock'))
      .rejects.toBeInstanceOf(InvalidTierError);
  });

  it('同租户同档位已有未过期 pending 订单 → 复用，不重复下单', async () => {
    const existing = {
      id: 'o-old', out_trade_no: 'no-old', qr_code_url: 'mock://old',
      expire_at: new Date(Date.now() + 60000), amount_fen: 10000, credits: 100,
    };
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*FROM zenithjoy\.payment_orders[\s\S]*status\s*=\s*'pending'/i.test(sql)) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await createRechargeOrder('t-1', 'tier_100', 'mock');

    expect(r.orderId).toBe('o-old');
    expect(r.qrCodeUrl).toBe('mock://old');
    const inserted = pool.query.mock.calls.some((c: any[]) =>
      /INSERT INTO zenithjoy\.payment_orders/i.test(c[0])
    );
    expect(inserted).toBe(false);
  });

  it('新订单：先落 created，下单成功后 CAS 到 pending 并回填二维码', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-new', out_trade_no: 'no-new' }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-new' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await createRechargeOrder('t-1', 'tier_100', 'mock');

    expect(r.orderId).toBe('o-new');
    expect(r.amountFen).toBe(10000);
    expect(r.credits).toBe(100);
    expect(r.qrCodeUrl).toContain('no-new');

    const cas = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders[\s\S]*'pending'/i.test(c[0])
    );
    expect(cas[0]).toMatch(/status\s*=\s*ANY\(/i);
  });

  it('平台下单失败 → 标 create_failed 并抛错，不留死单', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-fail', out_trade_no: 'no-fail' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const broken = new MockProvider();
    broken.createOrder = async () => { throw new Error('gateway 500'); };
    __setProviderForTest('mock', broken);

    await expect(createRechargeOrder('t-1', 'tier_100', 'mock')).rejects.toThrow('gateway 500');

    const failed = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('create_failed')
    );
    expect(failed).toBeDefined();
  });
});

describe('expireStaleOrders', () => {
  it('过期前先查单：查单说已付 → 入账，不标过期', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return { rows: [{ id: 'o-1', out_trade_no: 'no-1', provider: 'mock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    settleMock.mockResolvedValue({ outcome: 'credited' });

    const r = await expireStaleOrders();

    expect(settleMock).toHaveBeenCalledWith('no-1', 'mock');
    expect(r.credited).toBe(1);
    expect(r.expired).toBe(0);
    const marked = pool.query.mock.calls.some((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('expired')
    );
    expect(marked).toBe(false);
  });

  it('查单返回 credit_conflict（积分已入账、账实分叉）→ 绝不标过期', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return { rows: [{ id: 'o-3', out_trade_no: 'no-3', provider: 'mock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    settleMock.mockResolvedValue({ outcome: 'credit_conflict' });

    const r = await expireStaleOrders();

    expect(r.credited).toBe(1);
    expect(r.expired).toBe(0);
    const marked = pool.query.mock.calls.some((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('expired')
    );
    expect(marked).toBe(false);
  });

  it('查单说没付 → 才 CAS 标 expired', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return { rows: [{ id: 'o-2', out_trade_no: 'no-2', provider: 'mock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    settleMock.mockResolvedValue({ outcome: 'not_paid' });

    const r = await expireStaleOrders();

    expect(r.expired).toBe(1);
    const marked = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('expired')
    );
    expect(marked[0]).toMatch(/status\s*=\s*ANY\(/i);
  });

  it('单个订单结算抛错不影响其余订单继续处理', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return {
          rows: [
            { id: 'o-a', out_trade_no: 'no-a', provider: 'mock' },
            { id: 'o-b', out_trade_no: 'no-b', provider: 'mock' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    settleMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'not_paid' });

    const r = await expireStaleOrders();

    expect(r.scanned).toBe(2);
    expect(settleMock).toHaveBeenCalledTimes(2);
  });
});
