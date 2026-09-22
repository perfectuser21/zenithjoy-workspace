import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, createSign } from 'crypto';
import { WechatNativeProvider } from '../../../src/services/payment/wechat-native.provider';
import { SignatureError } from '../../../src/services/payment/types';

let platformPublicKey: string;
let platformPrivateKey: string;
let provider: WechatNativeProvider;

beforeAll(() => {
  const kp = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  platformPublicKey = kp.publicKey;
  platformPrivateKey = kp.privateKey;

  provider = new WechatNativeProvider({
    mchId: '1234567890',
    serialNo: 'ABC123',
    apiV3Key: '0123456789abcdef0123456789abcdef',
    merchantPrivateKey: kp.privateKey,
    platformPublicKeys: { 'PLAT-SERIAL-1': platformPublicKey },
    notifyUrl: 'https://example.com/api/payment/callback/wechat',
    appId: 'wxtestappid',
  });
});

/** 按微信 APIv3 规则构造签名：timestamp\nnonce\nbody\n */
function signCallback(timestamp: string, nonce: string, body: string): string {
  const s = `${timestamp}\n${nonce}\n${body}\n`;
  return createSign('RSA-SHA256').update(s).sign(platformPrivateKey, 'base64');
}

describe('WechatNativeProvider 验签', () => {
  const body = JSON.stringify({ id: 'evt-1', event_type: 'TRANSACTION.SUCCESS' });

  it('签名正确 → 通过', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    expect(() => provider.verifyCallback(Buffer.from(body), headers)).not.toThrow();
  });

  it('签名被篡改 → SignatureError', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body).replace(/^.{4}/, 'AAAA'),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    expect(() => provider.verifyCallback(Buffer.from(body), headers)).toThrow(SignatureError);
  });

  it('body 被篡改（签名对不上）→ SignatureError', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    const tampered = Buffer.from(JSON.stringify({ id: 'evt-1', amount: 999999 }));
    expect(() => provider.verifyCallback(tampered, headers)).toThrow(SignatureError);
  });

  it('未知平台证书序列号 → SignatureError（不静默放行）', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'UNKNOWN-SERIAL',
    };
    expect(() => provider.verifyCallback(Buffer.from(body), headers)).toThrow(SignatureError);
  });

  it('缺少签名头 → SignatureError', () => {
    expect(() => provider.verifyCallback(Buffer.from(body), {})).toThrow(SignatureError);
  });

  it('时间戳超出 5 分钟容忍窗 → SignatureError（防重放）', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    expect(() => provider.verifyCallback(Buffer.from(body), headers)).toThrow(SignatureError);
  });
});
