import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const settleMock = vi.fn();
const recordMock = vi.fn();
const refundMock = vi.fn();
const findOrderMock = vi.fn();
vi.mock('../../src/services/payment/settlement.service', () => ({
  settleOrder: settleMock,
  recordCallback: recordMock,
  markRefundPending: refundMock,
  findOrderByOutTradeNo: findOrderMock,
}));

import { paymentCallbackRouter } from '../../src/routes/payment-callback';
import { __setProviderForTest } from '../../src/services/payment/provider-registry';
import { MockProvider } from '../../src/services/payment/mock.provider';

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
});
