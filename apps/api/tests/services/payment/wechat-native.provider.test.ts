import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createSign, createCipheriv, randomBytes } from 'crypto';
import { WechatNativeProvider } from '../../../src/services/payment/wechat-native.provider';
import { SignatureError } from '../../../src/services/payment/types';

/** APIv3 key 必须是 32 字节；测试固定用一串好认的 32 位十六进制字符串 */
const API_V3_KEY = '0123456789abcdef0123456789abcdef';

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
    apiV3Key: API_V3_KEY,
    merchantPrivateKey: kp.privateKey,
    platformPublicKeys: { 'PLAT-SERIAL-1': platformPublicKey },
    notifyUrl: 'https://example.com/api/payment/callback/wechat',
    appId: 'wxtestappid',
  });
});

/**
 * 按 APIv3 AEAD_AES_256_GCM 规则加密出 resource 密文块。
 * decryptResource 直接把 body.resource.nonce 字符串原样传给 createDecipheriv（不做
 * 显式 Buffer 转换），Node 对字符串 IV 按 utf8 解释——nonce 必须是 12 个 ASCII 字符，
 * 加解密两侧都传同一个字符串才能得到相同的 12 字节 IV。
 */
function encryptResource(plainObj: Record<string, unknown>, aad = '') {
  const nonce = randomBytes(6).toString('hex'); // 12 个十六进制字符 = 12 字节 utf8
  const cipher = createCipheriv('aes-256-gcm', API_V3_KEY, nonce);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const plain = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, authTag]).toString('base64');
  return { ciphertext, nonce, associated_data: aad };
}

/** 按微信 APIv3 规则构造签名：timestamp\nnonce\nbody\n */
function signCallback(timestamp: string, nonce: string, body: string): string {
  const s = `${timestamp}\n${nonce}\n${body}\n`;
  return createSign('RSA-SHA256').update(s).sign(platformPrivateKey, 'base64');
}

describe('WechatNativeProvider 验签', () => {
  const body = JSON.stringify({
    id: 'evt-1',
    event_type: 'TRANSACTION.SUCCESS',
    out_trade_no: 'no-1',
    transaction_id: 'txn-1',
  });

  it('签名正确 → 通过，且正确解析出 outTradeNo / transactionId / eventType（M-8）', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    const ev = provider.verifyCallback(Buffer.from(body), headers);
    expect(ev).toEqual({
      outTradeNo: 'no-1',
      providerTransactionId: 'txn-1',
      eventType: 'paid',
    });
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

  it('未知平台证书序列号的错误消息不回显完整原始 header 值（M-2，防日志注入/信息泄露）', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'abc';
    // 攻击者完全可控的超长 header，混入非法字符
    const attackerSerial = 'X'.repeat(500) + '\n[FAKE LOG LINE] admin logged in' + ';DROP TABLE;';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': attackerSerial,
    };
    try {
      provider.verifyCallback(Buffer.from(body), headers);
      throw new Error('expected SignatureError');
    } catch (err) {
      expect(err).toBeInstanceOf(SignatureError);
      const msg = (err as Error).message;
      expect(msg).not.toContain(attackerSerial);
      expect(msg.length).toBeLessThan(100);
    }
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

describe('WechatNativeProvider APIv3 resource AEAD 解密（I-5，真实生产 100% 走这条分支）', () => {
  it('携带 resource 密文块 → 解密出正确的 outTradeNo / transactionId', () => {
    const resource = encryptResource({ out_trade_no: 'aead-no-1', transaction_id: 'aead-txn-1' });
    const body = JSON.stringify({
      id: 'evt-aead-1',
      event_type: 'TRANSACTION.SUCCESS',
      resource,
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'aeadn';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    const ev = provider.verifyCallback(Buffer.from(body), headers);
    expect(ev).toEqual({
      outTradeNo: 'aead-no-1',
      providerTransactionId: 'aead-txn-1',
      eventType: 'paid',
    });
  });

  it('resource 密文块的 authTag 被篡改 → 解密失败并抛错（不返回未认证明文）', () => {
    const resource = encryptResource({ out_trade_no: 'aead-no-2', transaction_id: 'aead-txn-2' });
    // 篡改 base64 密文尾部（authTag 落在末 16 字节）
    const buf = Buffer.from(resource.ciphertext, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tamperedResource = { ...resource, ciphertext: buf.toString('base64') };
    const body = JSON.stringify({
      id: 'evt-aead-3',
      event_type: 'TRANSACTION.SUCCESS',
      resource: tamperedResource,
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'aeadn2';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    // 收紧断言：不只是"抛了点什么"，而是 GCM 认证失败这个可辨识的错误
    // （Node crypto 对 authTag 校验失败固定抛 "Unsupported state or unable to
    // authenticate data"）——防止将来有人悄悄改成吞掉异常返回垃圾数据。
    expect(() => provider.verifyCallback(Buffer.from(body), headers))
      .toThrow(/unable to authenticate data/i);
  });

  it('携带非空 associated_data（微信生产固定下发 "transaction"）→ 加解密两侧都带 AAD 时正确解出（I-5 补全，此前该分支零覆盖）', () => {
    const resource = encryptResource(
      { out_trade_no: 'aead-no-4', transaction_id: 'aead-txn-4' },
      'transaction',
    );
    const body = JSON.stringify({
      id: 'evt-aead-4',
      event_type: 'TRANSACTION.SUCCESS',
      resource,
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'aeadn4';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    const ev = provider.verifyCallback(Buffer.from(body), headers);
    expect(ev).toEqual({
      outTradeNo: 'aead-no-4',
      providerTransactionId: 'aead-txn-4',
      eventType: 'paid',
    });
  });

  it('加密时带 AAD、解密时 AAD 不匹配（associated_data 被篡改）→ 抛错（防 AAD 漏传/被抽换）', () => {
    const resource = encryptResource(
      { out_trade_no: 'aead-no-5', transaction_id: 'aead-txn-5' },
      'transaction',
    );
    // 篡改 associated_data：加密时用的是 'transaction'，回调体里被换成别的值——
    // GCM 的 AAD 参与认证但不参与密文本身，篡改它必须导致 authTag 校验失败。
    const tamperedResource = { ...resource, associated_data: 'tampered' };
    const body = JSON.stringify({
      id: 'evt-aead-5',
      event_type: 'TRANSACTION.SUCCESS',
      resource: tamperedResource,
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'aeadn5';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    expect(() => provider.verifyCallback(Buffer.from(body), headers))
      .toThrow(/unable to authenticate data/i);
  });
});

describe('WechatNativeProvider event_type → eventType 映射（I-4，退款异常不能被静默归为 paid）', () => {
  function callbackWith(eventType: string) {
    const resource = encryptResource({ out_trade_no: 'no-evt', transaction_id: 'txn-evt' });
    const body = JSON.stringify({ id: 'evt-x', event_type: eventType, resource });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'evtn';
    const headers = {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signCallback(ts, nonce, body),
      'wechatpay-serial': 'PLAT-SERIAL-1',
    };
    return provider.verifyCallback(Buffer.from(body), headers);
  }

  it('TRANSACTION.SUCCESS → paid', () => {
    expect(callbackWith('TRANSACTION.SUCCESS').eventType).toBe('paid');
  });

  it('REFUND.SUCCESS → refunded', () => {
    expect(callbackWith('REFUND.SUCCESS').eventType).toBe('refunded');
  });

  it('REFUND.ABNORMAL → refunded（落 refund_pending 待人工），且打印明确告警日志（不能零告警）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(callbackWith('REFUND.ABNORMAL').eventType).toBe('refunded');
      expect(errSpy).toHaveBeenCalled();
      const loggedSomethingAboutAbnormal = errSpy.mock.calls.some((call) =>
        call.some((arg) => JSON.stringify(arg).includes('REFUND.ABNORMAL'))
      );
      expect(loggedSomethingAboutAbnormal).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('REFUND.CLOSED → refunded（同样落待人工）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(callbackWith('REFUND.CLOSED').eventType).toBe('refunded');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('未知事件类型 → closed（不做任何资金动作，不是验签问题）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(callbackWith('SOME.UNKNOWN.EVENT').eventType).toBe('closed');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('WechatNativeProvider APIv3 请求头（I-2，undici fetch 默认不发 User-Agent，微信网关要求携带）', () => {
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('createOrder 请求携带 User-Agent 头', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await provider.createOrder({
      outTradeNo: 'no-ua-1',
      amountFen: 100,
      description: '充值',
      expireAt: new Date(Date.now() + 60_000),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['User-Agent']).toBeTruthy();
  });

  it('queryOrder 请求携带 User-Agent 头', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ trade_state: 'NOTPAY' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await provider.queryOrder('no-ua-2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['User-Agent']).toBeTruthy();
  });
});
