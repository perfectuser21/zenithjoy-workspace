import { describe, it, expect, beforeAll } from 'vitest';
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
