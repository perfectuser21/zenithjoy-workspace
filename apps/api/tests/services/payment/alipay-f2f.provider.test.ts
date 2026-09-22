import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createSign } from 'crypto';
import { AlipayF2FProvider } from '../../../src/services/payment/alipay-f2f.provider';
import { SignatureError } from '../../../src/services/payment/types';

let alipayPrivateKey: string;
let provider: AlipayF2FProvider;

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  alipayPrivateKey = kp.privateKey;
  provider = new AlipayF2FProvider({
    appId: '2021000000000000',
    appPrivateKey: kp.privateKey,
    alipayPublicKey: kp.publicKey,
    sellerId: '2088000000000000',
    notifyUrl: 'https://example.com/api/payment/callback/alipay',
    gateway: 'https://openapi.alipay.com/gateway.do',
  });
});

/** 支付宝回调是 form-urlencoded；待签串 = 除 sign/sign_type 外按 key 排序的 k=v&… */
function signForm(params: Record<string, string>): string {
  const s = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createSign('RSA-SHA256').update(s, 'utf8').sign(alipayPrivateKey, 'base64');
}

describe('AlipayF2FProvider 验签', () => {
  const base = {
    out_trade_no: 'no-1',
    trade_no: 'txn-1',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '100.00',
    app_id: '2021000000000000',
    seller_id: '2088000000000000',
  };

  it('form-urlencoded 回调验签通过并解析出事件', () => {
    const params = { ...base, sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    const ev = provider.verifyCallback(body, {
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(ev).toEqual({
      outTradeNo: 'no-1',
      providerTransactionId: 'txn-1',
      eventType: 'paid',
    });
  });

  it('参数被篡改 → SignatureError', () => {
    const params = { ...base, sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    params.total_amount = '0.01';
    const body = Buffer.from(new URLSearchParams(params).toString());

    expect(() =>
      provider.verifyCallback(body, { 'content-type': 'application/x-www-form-urlencoded' })
    ).toThrow(SignatureError);
  });

  it('app_id 不匹配 → SignatureError（防他人应用的回调打进来）', () => {
    const params = { ...base, app_id: '9999999999999999', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    expect(() =>
      provider.verifyCallback(body, { 'content-type': 'application/x-www-form-urlencoded' })
    ).toThrow(SignatureError);
  });

  it('退款状态映射为 refunded 事件', () => {
    const params = { ...base, trade_status: 'TRADE_CLOSED', refund_fee: '100.00', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    const ev = provider.verifyCallback(body, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(ev.eventType).toBe('refunded');
  });

  it('seller_id 不匹配 → SignatureError（I-9，防同 appid 下收款账号被改配）', () => {
    const params = { ...base, seller_id: '9999999999999999', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    expect(() =>
      provider.verifyCallback(body, { 'content-type': 'application/x-www-form-urlencoded' })
    ).toThrow(SignatureError);
  });

  it('TRADE_CLOSED 且无 refund_fee → closed 事件（超时未付关闭，既非 paid 也非 refunded，I-3）', () => {
    const params = { ...base, trade_status: 'TRADE_CLOSED', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    const ev = provider.verifyCallback(body, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(ev.eventType).toBe('closed');
  });

  it('TRADE_FINISHED → paid 事件（I-3 白名单）', () => {
    const params = { ...base, trade_status: 'TRADE_FINISHED', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    const ev = provider.verifyCallback(body, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(ev.eventType).toBe('paid');
  });

  it('WAIT_BUYER_PAY（未付款中间态）→ closed（既非 paid 也非 refunded，不误判为已支付）', () => {
    const params = { ...base, trade_status: 'WAIT_BUYER_PAY', sign: '', sign_type: 'RSA2' };
    params.sign = signForm(params);
    const body = Buffer.from(new URLSearchParams(params).toString());

    const ev = provider.verifyCallback(body, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(ev.eventType).toBe('closed');
  });
});

describe('AlipayF2FProvider createOrder（C-1：biz_content 必须带 timeout_express，与本地订单 TTL 对称过期，否则商家把码放着、平台侧永久有效，本地却已标 expired，造成钱收了积分却到不了账）', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('按 expireAt 换算 timeout_express（分钟制），随下单一起发给支付宝网关', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        alipay_trade_precreate_response: { qr_code: 'https://qr.alipay.com/abc' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const expireAt = new Date(Date.now() + 30 * 60 * 1000); // 30 分钟后过期，与 ORDER_TTL_MS 一致
    await provider.createOrder({
      outTradeNo: 'no-timeout-1',
      amountFen: 10000,
      description: '积分充值',
      expireAt,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const parsedBody = new URLSearchParams(init.body as string);
    const bizContent = JSON.parse(parsedBody.get('biz_content') as string);
    expect(bizContent.timeout_express).toBe('30m');
  });

  it('请求携带 15s 超时 AbortSignal（跨境网关不设超时会钉住调用方）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        alipay_trade_precreate_response: { qr_code: 'https://qr.alipay.com/abc' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await provider.createOrder({
      outTradeNo: 'no-timeout-2',
      amountFen: 10000,
      description: '积分充值',
      expireAt: new Date(Date.now() + 60_000),
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('网关超时 → 抛出可辨识的超时错误（不是裸的 AbortError/TimeoutError 原文）', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    global.fetch = vi.fn().mockRejectedValue(timeoutErr) as unknown as typeof fetch;

    await expect(
      provider.createOrder({
        outTradeNo: 'no-timeout-3',
        amountFen: 10000,
        description: '积分充值',
        expireAt: new Date(Date.now() + 60_000),
      })
    ).rejects.toThrow(/ALIPAY.*TIMEOUT|超时/);
  });
});

describe('AlipayF2FProvider queryOrder', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('低成本项：平台成功但未返回 total_amount → amountFen 为 undefined，不静默当 0 分（会被误判为金额不符）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        alipay_trade_query_response: { trade_status: 'TRADE_SUCCESS', trade_no: 'txn-9' },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await provider.queryOrder('no-9');

    expect(r.status).toBe('success');
    expect(r.amountFen).toBeUndefined();
  });

  it('请求携带 15s 超时 AbortSignal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ alipay_trade_query_response: { trade_status: 'WAIT_BUYER_PAY' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await provider.queryOrder('no-10');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
