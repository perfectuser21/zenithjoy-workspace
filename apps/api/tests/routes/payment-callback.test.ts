import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// 与仓库既有约定一致（见 admin-license.test.ts 等）：vi.fn() 内联在工厂里创建，
// 不要在工厂外部 const 声明后再引用——vi.mock 会被提升到文件顶部，若工厂引用了
// 提升之前才初始化的外部变量会触发 "Cannot access before initialization"。
vi.mock('../../src/services/payment/settlement.service', () => ({
  settleOrder: vi.fn(),
  recordCallback: vi.fn(),
  markRefundPending: vi.fn(),
  findOrderByOutTradeNo: vi.fn(),
  deleteCallbackRecord: vi.fn(),
}));

import { paymentCallbackRouter } from '../../src/routes/payment-callback';
import {
  settleOrder,
  recordCallback,
  markRefundPending,
  findOrderByOutTradeNo,
  deleteCallbackRecord,
} from '../../src/services/payment/settlement.service';
import { __setProviderForTest } from '../../src/services/payment/provider-registry';
import { MockProvider } from '../../src/services/payment/mock.provider';
import type { CallbackEvent, PaymentProvider } from '../../src/services/payment/types';

const settleMock = settleOrder as ReturnType<typeof vi.fn>;
const recordMock = recordCallback as ReturnType<typeof vi.fn>;
const refundMock = markRefundPending as ReturnType<typeof vi.fn>;
const findOrderMock = findOrderByOutTradeNo as ReturnType<typeof vi.fn>;
const deleteMock = deleteCallbackRecord as ReturnType<typeof vi.fn>;

function makeApp() {
  const app = express();
  app.use('/api/payment/callback', express.raw({ type: '*/*' }), paymentCallbackRouter);
  return app;
}

const paidBody = JSON.stringify({
  out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'paid',
});

beforeEach(() => {
  settleMock.mockReset().mockResolvedValue({ outcome: 'credited', orderId: 'o-1' });
  recordMock.mockReset().mockResolvedValue(true);
  refundMock.mockReset();
  findOrderMock.mockReset().mockResolvedValue({ id: 'o-1', tenantId: 't-1' });
  deleteMock.mockReset().mockResolvedValue(undefined);
  __setProviderForTest('mock', new MockProvider());
});

describe('POST /api/payment/callback/:provider', () => {
  it('验签失败 → 403，且不落库不结算', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'bad')
      .send(paidBody);

    expect(res.status).toBe(403);
    expect(recordMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('验签通过 + 首次投递 → 结算并返回 200', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
    expect(settleMock).toHaveBeenCalledWith('no-1', 'mock');
  });

  it('重复投递（recordCallback 返回 false）→ 200 且不重复结算', async () => {
    recordMock.mockResolvedValue(false);

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('己方异常（结算抛错）→ 5xx，绝不返回 200', async () => {
    settleMock.mockRejectedValue(new Error('db down'));

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  // I-1：recordCallback（写审计，靠 UNIQUE 判首次）排在 settleOrder 之前。首次投递若
  // settleOrder 抛错返 5xx，平台重推时 recordCallback 会命中 UNIQUE 返回 false，
  // 路由直接 200 "duplicate"——结算被永久跳过。必须在本次是首次插入且后续处理失败时，
  // 把本次刚插入的审计行删掉，让平台重推能重新走完整流程。
  it('I-1：首次投递但结算抛错(5xx) → 删除本次刚写入的审计行，避免下次重推被误判为重复', async () => {
    settleMock.mockRejectedValue(new Error('db down'));

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(deleteMock).toHaveBeenCalledWith('mock', 'txn-1', 'paid');
  });

  it('I-1：重复投递（非首次插入）时即使后面出错也不该走到，也绝不会误删别人的审计行', async () => {
    recordMock.mockResolvedValue(false);

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
    expect(settleMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('退款事件 → 落 refund_pending，不自动扣回积分', async () => {
    const refundBody = JSON.stringify({
      out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'refunded',
    });

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(refundBody);

    expect(res.status).toBe(200);
    expect(refundMock).toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('审计行带上订单与租户归属（租户隔离铁律）', async () => {
    await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(recordMock).toHaveBeenCalledWith(
      'mock', 'txn-1', 'paid', expect.any(String), 'o-1', 't-1'
    );
  });

  it('对不上任何订单的回调仍留审计痕迹，租户与订单列为 null', async () => {
    findOrderMock.mockResolvedValue(null);

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(recordMock).toHaveBeenCalledWith(
      'mock', 'txn-1', 'paid', expect.any(String), null, null
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ['credited'], ['already_credited'], ['credit_conflict'],
    ['amount_mismatch'], ['not_paid'], ['order_not_found'],
  ])('业务结论 %s 一律返 200（重试解决不了已得出结论的事）', async (outcome) => {
    settleMock.mockResolvedValue({ outcome });

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
  });

  it('未知 provider → 404，不抛未捕获异常', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/paypal')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(404);
  });

  it('closed 事件（交易关闭，如超时未付）→ 记审计后直接 200，不结算不落 refund_pending（I-3）', async () => {
    // MockProvider 的 event_type 输入被限定为 'paid'|'refunded'，这里直接注入一个
    // 返回 'closed' 的假 provider 来驱动路由的 eventType 分支。
    const closedProvider: PaymentProvider = {
      name: 'mock',
      async createOrder() {
        return { qrCodeUrl: 'mock://x' };
      },
      verifyCallback(): CallbackEvent {
        return { outTradeNo: 'no-1', providerTransactionId: 'txn-1', eventType: 'closed' };
      },
      async queryOrder() {
        return { status: 'closed' };
      },
    };
    __setProviderForTest('mock', closedProvider);

    // N-2：这里把注册表里的 'mock' 换成了假 provider，测试完必须换回真 MockProvider——
    // 否则单例污染会漏到后面追加的用例里，表现为"莫名其妙全 closed"，极难排查（同族
    // 问题此前在 I-7 的 NODE_ENV 泄漏上出现过）。beforeEach 每次都会重设一次，这里
    // 用 try/finally 兜底，不依赖"这是不是文件最后一个 it"这种脆弱假设。
    try {
      const res = await request(makeApp())
        .post('/api/payment/callback/mock')
        .set('Content-Type', 'application/json')
        .send(paidBody);

      expect(res.status).toBe(200);
      expect(recordMock).toHaveBeenCalledWith(
        'mock', 'txn-1', 'closed', expect.any(String), 'o-1', 't-1'
      );
      expect(settleMock).not.toHaveBeenCalled();
      expect(refundMock).not.toHaveBeenCalled();
    } finally {
      __setProviderForTest('mock', new MockProvider());
    }
  });
});
