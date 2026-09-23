import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

// vi.mock 工厂被提升到文件最顶端（先于下方任何 import/const 执行），工厂内引用的
// 变量必须同样提升，否则命中 TDZ 报 "Cannot access before initialization"。
// rechargeMock 不以 "mock" 开头，vitest 的自动提升识别不到它，需显式 vi.hoisted。
const { rechargeMock } = vi.hoisted(() => ({ rechargeMock: vi.fn() }));
vi.mock('../../../src/services/credits.service', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, rechargeInTx: rechargeMock };
});

import { settleOrder, findOrderByOutTradeNo, recordCallback, markRefundPending, deleteCallbackRecord } from '../../../src/services/payment/settlement.service';
import { __setProviderForTest } from '../../../src/services/payment/provider-registry';
import { MockProvider } from '../../../src/services/payment/mock.provider';
import { DuplicateCreditError } from '../../../src/services/credits.service';

const db = await import('../../../src/db/connection') as any;
const client = db.__client;
let mp: MockProvider;

const ORDER = {
  id: 'o-1', tenant_id: 't-1', out_trade_no: 'no-1', provider: 'mock',
  amount_fen: 10000, credits: 100, status: 'pending',
};

beforeEach(() => {
  client.query.mockReset();
  db.default.query.mockReset();
  db.default.connect.mockClear();
  client.release.mockClear();
  rechargeMock.mockReset().mockResolvedValue({ balance: 100, total_recharged: 100, total_consumed: 0 });
  mp = new MockProvider();
  __setProviderForTest('mock', mp);
});

/**
 * 同一份实现要同时挂到 client.query 和 pool.query（db.default.query）上：
 * F1 之后 SELECT 订单、amount_mismatch 的 UPDATE 走 pool.query（不占连接），
 * 只有 CAS + 入账那一段才走 client.query（占连接的那一段）。
 */
function mockDb(order: any, casRowCount: number) {
  const impl = async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};
    if (/SELECT [\s\S]*FROM zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: casRowCount ? [{ ...order, status: 'credited' }] : [], rowCount: casRowCount };
    }
    return { rows: [], rowCount: 0 };
  };
  client.query.mockImplementation(impl);
  db.default.query.mockImplementation(impl);
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

  it('重复结算：CAS rowCount=0 但补读到当前状态确实是 credited → 返回 already_credited', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'credited' }, 0);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('already_credited');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  // C-2：CAS 未命中的真实原因不一定是"已入账"，可能是 expired/amount_mismatch/
  // refund_pending/created 等任何非 pending 状态。此前一律返 already_credited，
  // 会让前端把"钱可能已收但订单已过期、需人工核查"的场景误报成"充值成功"。
  it('C-2：CAS rowCount=0 且补读到当前状态是 expired（C-1 场景：支付宝码永不过期，商家超时后才扫码付款）→ not_settlable + 响亮告警，不能谎报 already_credited', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'expired' }, 0);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await settleOrder('no-1', 'mock');

      expect(r.outcome).toBe('not_settlable');
      expect(rechargeMock).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('人工核查'),
        expect.objectContaining({
          payment_order_id: 'o-1',
          tenant_id: 't-1',
          out_trade_no: 'no-1',
          provider_transaction_id: 'txn-1',
          current_status: 'expired',
        })
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('C-2：CAS rowCount=0 且补读到当前状态是其它非 credited 状态（如 refund_pending）→ 同样 not_settlable，不当作成功', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'refund_pending' }, 0);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = await settleOrder('no-1', 'mock');
      expect(r.outcome).toBe('not_settlable');
      expect(rechargeMock).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('C-2：补读发生在 ROLLBACK 之前，且只用于分类/日志，不参与决策（补读语句走 CAS 所在事务的 client）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'expired' }, 0);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await settleOrder('no-1', 'mock');

    const calls = client.query.mock.calls.map((c: any[]) => String(c[0]));
    const rollbackIdx = calls.findIndex((s) => s === 'ROLLBACK');
    const selectIdx = calls.findIndex((s) => /SELECT status FROM zenithjoy\.payment_orders/i.test(s));
    expect(selectIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(selectIdx);
  });

  it('金额不符 → 不入账，标 amount_mismatch（生产 SQL 用字面量，不是参数化拼断言）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 1, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('amount_mismatch');
    expect(rechargeMock).not.toHaveBeenCalled();
    // 断言 SQL 文本本身含字面量 'amount_mismatch'，而不是随便在参数数组里含这个词就算数
    // （参数数组里塞进 failure_reason 文案照样能让弱断言通过，不能证明状态真被改成了 amount_mismatch）
    const upd = db.default.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && /SET status = 'amount_mismatch'/.test(c[0])
    );
    expect(upd).toBeDefined();
    // 且此路径绝不能占用池连接
    expect(db.default.connect).not.toHaveBeenCalled();
  });

  it('金额校验 fail-closed：查单没返回金额 → 不入账，标 amount_mismatch（不是 not_paid，也不是直接放行）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', transactionId: 'txn-1' }); // 无 amountFen
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('amount_mismatch');
    expect(rechargeMock).not.toHaveBeenCalled();
    const upd = db.default.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && /SET status = 'amount_mismatch'/.test(c[0])
    );
    expect(upd).toBeDefined();
    // 缺失金额与金额不符要能区分文案，便于运营分流
    expect(String(upd?.[1]).includes('未返回金额') || upd?.[1]?.some?.((v: any) => typeof v === 'string' && v.includes('未返回金额'))).toBeTruthy();
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

  it('入账抛错（非重复入账）→ 事务 ROLLBACK 并向上抛（调用方据此返 5xx 让平台重试）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    rechargeMock.mockRejectedValue(new Error('db down'));

    await expect(settleOrder('no-1', 'mock')).rejects.toThrow('db down');
    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
    // 非重复入账错误：坏连接不能回池子，必须带 err 销毁
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('入账命中 DuplicateCreditError（积分已入账但订单状态没跟上）→ 自愈补状态，返回 credit_conflict，不再向上抛', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    rechargeMock.mockRejectedValue(new (DuplicateCreditError as any)('o-1'));

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('credit_conflict');
    expect(r.orderId).toBe('o-1');
    // 必须先 ROLLBACK（事务内语句失败后整个事务已 aborted，不 ROLLBACK 没法再发别的语句）
    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
    // 补状态用独立语句、字面量 'credited'，走 pool 而不是已经作废的 client
    const heal = db.default.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && /SET status = 'credited'/.test(c[0]) && /id = \$1/.test(c[0])
    );
    expect(heal).toBeDefined();
    expect(heal![1][0]).toBe('o-1');
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

  it('F1：查单（跨境 HTTP，秒级/可能超时）期间手里不能已经握着池连接，否则回调高峰会钉住连接池', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    let connectCallsAtQueryTime = -1;
    const originalQueryOrder = mp.queryOrder.bind(mp);
    vi.spyOn(mp, 'queryOrder').mockImplementation(async (outTradeNo: string) => {
      connectCallsAtQueryTime = db.default.connect.mock.calls.length;
      return originalQueryOrder(outTradeNo);
    });

    await settleOrder('no-1', 'mock');

    // 查单发生时 connect() 一次都没被调用过——如果有人把 pool.connect() 挪回函数开头，
    // 这里会从 0 变成 1，本条必红。
    expect(connectCallsAtQueryTime).toBe(0);
    // 且全程只在真正要入账时 connect 一次
    expect(db.default.connect).toHaveBeenCalledTimes(1);
  });
});

describe('findOrderByOutTradeNo', () => {
  it('查到订单返回 id/tenantId，走 pool.query 不占连接', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [{ id: 'o-1', tenant_id: 't-1' }], rowCount: 1 });
    const r = await findOrderByOutTradeNo('mock', 'no-1');
    expect(r).toEqual({ id: 'o-1', tenantId: 't-1' });
    expect(db.default.connect).not.toHaveBeenCalled();
  });

  it('查不到返回 null', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const r = await findOrderByOutTradeNo('mock', 'nope');
    expect(r).toBeNull();
  });
});

describe('recordCallback', () => {
  it('rowCount=1（首次投递）→ 返回 true', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [{ id: 'cb-1' }], rowCount: 1 });
    const r = await recordCallback('mock', 'txn-1', 'paid', 'digest', 'o-1', 't-1');
    expect(r).toBe(true);
  });

  it('rowCount=0（ON CONFLICT DO NOTHING 命中，重复投递）→ 返回 false', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const r = await recordCallback('mock', 'txn-1', 'paid', 'digest', 'o-1', 't-1');
    expect(r).toBe(false);
  });
});

// I-1：审计去重闸排在结算之前——首次投递若结算失败返 5xx，平台重推时
// recordCallback 命中 UNIQUE 会直接判"重复"返 200，结算被永久跳过。
// deleteCallbackRecord 是路由在"本次是首次插入、后续处理却失败"时的补救：
// 删掉本次刚插入的那条审计行，让平台重推能重新走完整流程。
describe('deleteCallbackRecord', () => {
  it('按 provider + provider_transaction_id + event_type 精确删除，不误删其它记录', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await deleteCallbackRecord('mock', 'txn-1', 'paid');

    expect(db.default.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.default.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM zenithjoy\.payment_callbacks/i);
    expect(params).toEqual(['mock', 'txn-1', 'paid']);
  });
});

describe('markRefundPending', () => {
  it('绝不触碰积分：只对 payment_orders 发一条 UPDATE，SQL 里不含 credit_transactions 或任何 consume 调用', async () => {
    db.default.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const ok = await markRefundPending('o-1');

    expect(ok).toBe(true);
    expect(db.default.query).toHaveBeenCalledTimes(1);
    const [sql] = db.default.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE zenithjoy\.payment_orders/i);
    expect(sql).not.toMatch(/credit_transactions/i);
    expect(sql).not.toMatch(/consume/i);
    expect(rechargeMock).not.toHaveBeenCalled();
    expect(db.default.connect).not.toHaveBeenCalled();
  });

  // I-3：ALLOWED_TRANSITIONS.refund_pending = ['credited']。退款回调早于入账、或订单
  // 已 expired 时，UPDATE 影响 0 行，此前函数静默返回、路由照样 200——一笔该人工处理
  // 的退款就此消失，零告警。必须检查 rowCount，未命中时响亮告警并让调用方能感知。
  it('I-3：CAS 未命中（订单不是 credited 状态，如退款回调早于入账）→ 告警带订单 id 与当前状态，返回 false', async () => {
    db.default.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE 未命中
      .mockResolvedValueOnce({ rows: [{ status: 'pending' }], rowCount: 1 }); // 补读当前状态
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const ok = await markRefundPending('o-1');

      expect(ok).toBe(false);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('人工核查'),
        expect.objectContaining({ payment_order_id: 'o-1', current_status: 'pending' })
      );
    } finally {
      errSpy.mockRestore();
    }
  });
});
