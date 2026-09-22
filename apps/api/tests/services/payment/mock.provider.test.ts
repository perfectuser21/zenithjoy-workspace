import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockProvider } from '../../../src/services/payment/mock.provider';
import { getProvider } from '../../../src/services/payment/provider-registry';
import { SignatureError } from '../../../src/services/payment/types';

describe('MockProvider', () => {
  let p: MockProvider;
  beforeEach(() => { p = new MockProvider(); });

  it('createOrder 返回可用二维码地址', async () => {
    const r = await p.createOrder({
      outTradeNo: 'no-1', amountFen: 10000,
      description: '充值', expireAt: new Date(Date.now() + 60000),
    });
    expect(r.qrCodeUrl).toContain('no-1');
  });

  it('签名头正确时解析出事件', () => {
    const body = Buffer.from(JSON.stringify({
      out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'paid',
    }));
    const ev = p.verifyCallback(body, { 'x-mock-signature': 'valid' });
    expect(ev).toEqual({ outTradeNo: 'no-1', providerTransactionId: 'txn-1', eventType: 'paid' });
  });

  it('签名头缺失或错误时抛 SignatureError（调用方据此返回 403）', () => {
    const body = Buffer.from('{}');
    expect(() => p.verifyCallback(body, {})).toThrow(SignatureError);
    expect(() => p.verifyCallback(body, { 'x-mock-signature': 'bad' })).toThrow(SignatureError);
  });

  it('queryOrder 默认 pending，可被测试钩子改写', async () => {
    expect(await p.queryOrder('no-1')).toEqual({ status: 'pending' });
    p.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    expect(await p.queryOrder('no-1')).toEqual({
      status: 'success', amountFen: 10000, transactionId: 'txn-1',
    });
  });
});

describe('provider-registry', () => {
  it('未知 provider 名抛错，不返回 undefined（防静默走空实现）', () => {
    expect(() => getProvider('paypal')).toThrow('UNKNOWN_PROVIDER');
  });

  it('mock 可取到', () => {
    expect(getProvider('mock').name).toBe('mock');
  });

  it('production 环境不注册 mock（防止生产下单到假网关）', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { getProvider: freshGetProvider } = await import(
      '../../../src/services/payment/provider-registry'
    );
    expect(() => freshGetProvider('mock')).toThrow('UNKNOWN_PROVIDER');
    process.env.NODE_ENV = prev;
    vi.resetModules();
  });
});
