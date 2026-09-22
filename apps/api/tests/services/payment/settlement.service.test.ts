import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

const rechargeMock = vi.fn();
vi.mock('../../../src/services/credits.service', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, rechargeInTx: rechargeMock };
});

import { settleOrder } from '../../../src/services/payment/settlement.service';
import { __setProviderForTest } from '../../../src/services/payment/provider-registry';
import { MockProvider } from '../../../src/services/payment/mock.provider';

const db = await import('../../../src/db/connection') as any;
const client = db.__client;
let mp: MockProvider;

const ORDER = {
  id: 'o-1', tenant_id: 't-1', out_trade_no: 'no-1', provider: 'mock',
  amount_fen: 10000, credits: 100, status: 'pending',
};

beforeEach(() => {
  client.query.mockReset();
  rechargeMock.mockReset().mockResolvedValue({ balance: 100, total_recharged: 100, total_consumed: 0 });
  mp = new MockProvider();
  __setProviderForTest('mock', mp);
});

function mockDb(order: any, casRowCount: number) {
  client.query.mockImplementation(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};
    if (/SELECT .* FROM zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: casRowCount ? [{ ...order, status: 'credited' }] : [], rowCount: casRowCount };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('settleOrder', () => {
  it('查单成功 + CAS 生效 → 入账一次', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('credited');
    expect(rechargeMock).toHaveBeenCalledTimes(1);
    expect(rechargeMock).toHaveBeenCalledWith(
      client, 't-1', 100, 'recharge',
      expect.objectContaining({ order_id: 'o-1', provider: 'mock' }), 'o-1'
    );
  });

  it('入账必须用 CAS 所在的同一个 client（否则两个独立事务 → 重复入账通道）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    await settleOrder('no-1', 'mock');

    const passedClient = rechargeMock.mock.calls[0][0];
    expect(passedClient).toBe(client);
    // 且 recharge（自带事务的那个）绝不能被用在这条路径上
    expect(client.query.mock.calls.filter((c: any[]) => c[0] === 'BEGIN')).toHaveLength(1);
  });

  it('重复结算：CAS rowCount=0 → 不入账，返回 already_credited', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'credited' }, 0);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('already_credited');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('金额不符 → 不入账，标 amount_mismatch', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 1, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('amount_mismatch');
    expect(rechargeMock).not.toHaveBeenCalled();
    const upd = client.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('amount_mismatch')
    );
    expect(upd).toBeDefined();
  });

  it('平台说没付 → 不入账，不改状态', async () => {
    mp.__setQueryResult('no-1', { status: 'pending' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('not_paid');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('订单不存在 → order_not_found，不抛异常', async () => {
    mockDb(null, 0);
    const r = await settleOrder('nope', 'mock');
    expect(r.outcome).toBe('order_not_found');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('入账抛错 → 事务 ROLLBACK 并向上抛（调用方据此返 5xx 让平台重试）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    rechargeMock.mockRejectedValue(new Error('db down'));

    await expect(settleOrder('no-1', 'mock')).rejects.toThrow('db down');
    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
  });

  it('CAS 语句用 status = ANY 合法前置集合，不是先查后改', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    await settleOrder('no-1', 'mock');

    const cas = client.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders[\s\S]*SET status\s*=\s*'credited'/i.test(c[0])
    );
    expect(cas[0]).toMatch(/status\s*=\s*ANY\(/i);
  });
});
