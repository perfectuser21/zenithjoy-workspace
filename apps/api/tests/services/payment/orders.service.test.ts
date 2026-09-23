import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

// vi.mock 工厂被提升到文件最顶端（先于下方任何 import/const 执行），工厂内引用的
// 变量必须以 "mock" 开头才会被 vitest 自动一并提升，否则 TDZ 报错——
// settleMock 不以 "mock" 开头，vitest 的自动提升识别不到它，需显式 vi.hoisted。
// 同仓库先例：tests/services/payment/settlement.service.test.ts 的 rechargeMock。
const { settleMock } = vi.hoisted(() => ({ settleMock: vi.fn() }));
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
    let insertedOutTradeNo: string | undefined;
    pool.query.mockImplementation(async (sql: string, params?: any[]) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        insertedOutTradeNo = params?.[1];
        // 真实 Postgres 会原样存下传入的 out_trade_no，mock 也照此回显（params[1] 是 out_trade_no）
        return { rows: [{ id: 'o-new', out_trade_no: params?.[1] }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-new' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // 用 provider.createOrder 的真实调用参数捕获实际下单时用的商户订单号，
    // 而不是凭空编一个字符串断言——这样如果实现改传别的值给 createOrder，
    // 下面的断言必须变红。
    const provider = new MockProvider();
    const createOrderCalls: Array<{ outTradeNo: string }> = [];
    const originalCreateOrder = provider.createOrder.bind(provider);
    provider.createOrder = async (input) => {
      createOrderCalls.push(input);
      return originalCreateOrder(input);
    };
    __setProviderForTest('mock', provider);

    const r = await createRechargeOrder('t-1', 'tier_100', 'mock');

    expect(r.orderId).toBe('o-new');
    expect(r.amountFen).toBe(10000);
    expect(r.credits).toBe(100);

    expect(createOrderCalls).toHaveLength(1);
    const actualOutTradeNo = createOrderCalls[0].outTradeNo;
    // 服务端生成格式：ZJ<时间戳><8位hex>
    expect(actualOutTradeNo).toMatch(/^ZJ\d+[0-9a-f]{8}$/);
    expect(actualOutTradeNo).toBe(insertedOutTradeNo);
    expect(r.qrCodeUrl).toContain(actualOutTradeNo);

    const cas = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders[\s\S]*'pending'/i.test(c[0])
    );
    expect(cas[0]).toMatch(/status\s*=\s*ANY\(/i);
  });

  it('CAS created→pending 未生效（rowCount!==1）→ 抛错，不留卡死的 created 订单', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-cas' }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders[\s\S]*'pending'/i.test(sql)) {
        // 模拟订单已不在 created 状态：CAS 影响 0 行
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createRechargeOrder('t-1', 'tier_100', 'mock'))
      .rejects.toThrow(/o-cas/);
  });

  it('平台下单失败 → 标 create_failed 并抛错，不留死单', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-fail', out_trade_no: 'no-fail' }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders[\s\S]*'create_failed'/i.test(sql)) {
        // 正常路径：CAS 生效（这条用例只验证"下单失败→标 create_failed→原错上抛"，
        // 不是在测 CAS 未生效场景——那个场景有独立用例覆盖，见下方）
        return { rows: [{ id: 'o-fail' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const broken = new MockProvider();
    broken.createOrder = async () => { throw new Error('gateway 500'); };
    __setProviderForTest('mock', broken);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(createRechargeOrder('t-1', 'tier_100', 'mock')).rejects.toThrow('gateway 500');

    // 断言 SQL 文本本身含字面量 'create_failed'，而不是参数数组里随便含这个词就算数
    // （生产 SQL 用字面量写目标状态，CAS 前置状态集合才是参数——同仓库既有约定见
    // settlement.service.test.ts「生产 SQL 用字面量，不是参数化拼断言」）
    const failed = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && /SET status = 'create_failed'/.test(c[0])
    );
    expect(failed).toBeDefined();
    // 正常路径下 CAS 生效，不该有任何 rowCount 异常告警
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('CAS create_failed 未生效（rowCount!==1）→ 仅 warn，不吞原始下单失败异常', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-fail2' }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders[\s\S]*'create_failed'/i.test(sql)) {
        // 模拟订单已不在 created 状态：CAS 影响 0 行
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const broken = new MockProvider();
    broken.createOrder = async () => { throw new Error('gateway 500 again'); };
    __setProviderForTest('mock', broken);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // CAS 未生效不能替换或吞掉原始下单失败异常，必须照常上抛
    await expect(createRechargeOrder('t-1', 'tier_100', 'mock')).rejects.toThrow('gateway 500 again');

    expect(warnSpy).toHaveBeenCalled();
    const [warnMsg, warnMeta] = warnSpy.mock.calls[0];
    expect(String(warnMsg)).toMatch(/create_failed/);
    expect(JSON.stringify(warnMeta)).toContain('o-fail2');

    warnSpy.mockRestore();
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
    // 同上：断言 SQL 文本含字面量 'expired'，参数数组里只有 CAS 前置状态集合
    const marked = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && /SET status = 'expired'/.test(c[0])
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
