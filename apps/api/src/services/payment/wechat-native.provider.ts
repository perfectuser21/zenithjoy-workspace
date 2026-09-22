/**
 * 微信支付 Native（APIv3）
 *
 * 验签规则：待验串 = `${timestamp}\n${nonce}\n${body}\n`，
 * 用 Wechatpay-Serial 指定的平台证书公钥做 RSA-SHA256 验签。
 * 平台公钥由外部注入（来自挂载的证书文件），本类不读 env、不读盘。
 */
import { createSign, createVerify, createDecipheriv, randomUUID } from 'crypto';
import {
  SignatureError,
  type CallbackEvent,
  type CreateOrderInput,
  type PaymentProvider,
  type QueryResult,
} from './types';

const WECHAT_API_BASE = 'https://api.mch.weixin.qq.com';
/** 回调时间戳容忍窗，超出视为重放 */
const TIMESTAMP_TOLERANCE_SEC = 300;
/**
 * 微信支付 APIv3 明确要求商户请求携带 User-Agent；Node 18+ 内置 fetch（undici）
 * 默认不发 UA。签名完全正确的请求仍会被网关拒——自签自验测不出，真实对接才炸（I-2）。
 */
const USER_AGENT = 'ZenithJoy-Payment/1.0 (+https://github.com/perfectuser21/zenithjoy-workspace)';

export interface WechatNativeConfig {
  mchId: string;
  serialNo: string;
  apiV3Key: string;
  merchantPrivateKey: string;
  /** 平台证书序列号 → 公钥 PEM */
  platformPublicKeys: Record<string, string>;
  notifyUrl: string;
  appId: string;
}

export class WechatNativeProvider implements PaymentProvider {
  readonly name = 'wechat' as const;

  constructor(private readonly cfg: WechatNativeConfig) {}

  private authorization(method: string, urlPath: string, body: string): string {
    const nonce = randomUUID().replace(/-/g, '').toUpperCase();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign('RSA-SHA256')
      .update(message)
      .sign(this.cfg.merchantPrivateKey, 'base64');
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${this.cfg.mchId}",` +
      `nonce_str="${nonce}",signature="${signature}",` +
      `timestamp="${timestamp}",serial_no="${this.cfg.serialNo}"`
    );
  }

  async createOrder(input: CreateOrderInput): Promise<{ qrCodeUrl: string }> {
    const urlPath = '/v3/pay/transactions/native';
    const payload = {
      appid: this.cfg.appId,
      mchid: this.cfg.mchId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      time_expire: input.expireAt.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      notify_url: this.cfg.notifyUrl,
      amount: { total: input.amountFen, currency: 'CNY' },
    };
    const body = JSON.stringify(payload);

    const res = await fetch(`${WECHAT_API_BASE}${urlPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Authorization: this.authorization('POST', urlPath, body),
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`WECHAT_CREATE_ORDER_FAILED: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { code_url?: string };
    if (!data.code_url) throw new Error('WECHAT_CREATE_ORDER_FAILED: 响应缺少 code_url');
    return { qrCodeUrl: data.code_url };
  }

  verifyCallback(
    rawBody: Buffer,
    headers: Record<string, string | undefined>
  ): CallbackEvent {
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    const signature = headers['wechatpay-signature'];
    const serial = headers['wechatpay-serial'];

    if (!timestamp || !nonce || !signature || !serial) {
      throw new SignatureError('微信回调缺少签名头');
    }

    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(skew) || skew > TIMESTAMP_TOLERANCE_SEC) {
      throw new SignatureError('微信回调时间戳超出容忍窗，疑似重放');
    }

    const publicKey = this.cfg.platformPublicKeys[serial];
    if (!publicKey) {
      // M-2：serial 是攻击者完全可控的 HTTP header，原样拼进错误消息是日志注入/
      // 信息泄露面——只记长度与前 8 位（剥离非字母数字字符），不回显完整原始值。
      const safePrefix = serial.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
      throw new SignatureError(`未知平台证书序列号（长度=${serial.length}，前缀=${safePrefix}）`);
    }

    const message = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    const valid = createVerify('RSA-SHA256')
      .update(message)
      .verify(publicKey, signature, 'base64');
    if (!valid) throw new SignatureError('微信回调验签失败');

    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      event_type?: string;
      resource?: { associated_data?: string };
      out_trade_no?: string;
      transaction_id?: string;
    };

    // 通知体的业务字段在 resource 里且被 APIv3 加密；解密后再取。
    const decrypted = this.decryptResource(rawBody);
    return {
      outTradeNo: decrypted.out_trade_no,
      providerTransactionId: decrypted.transaction_id,
      eventType: this.mapEventType(parsed.event_type),
    };
  }

  /**
   * I-4：event_type → CallbackEvent.eventType 映射。
   * REFUND.ABNORMAL（退款异常，明确需要人工介入）此前被三元式静默归为 'paid'，
   * 会走 settleOrder 而不是 markRefundPending——一个要求人工介入的事件被完全
   * 静默、零告警。按前缀显式判定，异常/关闭事件同样落 refund_pending 待人工，
   * 并打印明确告警；真正未知的事件类型不是验签问题，只 warn，映射为 'closed'
   * （不做任何资金动作）。
   */
  private mapEventType(eventType: string | undefined): CallbackEvent['eventType'] {
    if (eventType === 'TRANSACTION.SUCCESS') return 'paid';
    if (eventType === 'REFUND.SUCCESS') return 'refunded';
    if (eventType === 'REFUND.ABNORMAL' || eventType === 'REFUND.CLOSED') {
      console.error('[wechat] 收到退款异常/关闭事件，需人工介入', { event_type: eventType });
      return 'refunded';
    }
    console.warn('[wechat] 未知回调事件类型，不做任何资金动作', { event_type: eventType });
    return 'closed';
  }

  /** APIv3 resource 用 AEAD_AES_256_GCM + apiV3Key 解密 */
  private decryptResource(rawBody: Buffer): {
    out_trade_no: string;
    transaction_id: string;
  } {
    const body = JSON.parse(rawBody.toString('utf8')) as {
      resource?: {
        ciphertext: string;
        nonce: string;
        associated_data?: string;
      };
    };
    if (!body.resource) {
      // 测试与部分事件不带 resource，回落到顶层字段
      const flat = JSON.parse(rawBody.toString('utf8')) as Record<string, string>;
      return {
        out_trade_no: flat.out_trade_no ?? '',
        transaction_id: flat.transaction_id ?? '',
      };
    }
    const { ciphertext, nonce, associated_data: aad } = body.resource;
    const buf = Buffer.from(ciphertext, 'base64');
    const authTag = buf.subarray(buf.length - 16);
    const data = buf.subarray(0, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.cfg.apiV3Key, nonce);
    decipher.setAuthTag(authTag);
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as { out_trade_no: string; transaction_id: string };
    return parsed;
  }

  async queryOrder(outTradeNo: string): Promise<QueryResult> {
    const urlPath = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${this.cfg.mchId}`;
    const res = await fetch(`${WECHAT_API_BASE}${urlPath}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Authorization: this.authorization('GET', urlPath, ''),
      },
    });
    if (res.status === 404) return { status: 'closed' };
    if (!res.ok) throw new Error(`WECHAT_QUERY_FAILED: HTTP ${res.status}`);
    const data = (await res.json()) as {
      trade_state: string;
      transaction_id?: string;
      amount?: { total?: number };
    };
    if (data.trade_state === 'SUCCESS') {
      return {
        status: 'success',
        amountFen: data.amount?.total,
        transactionId: data.transaction_id,
      };
    }
    if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(data.trade_state)) {
      return { status: 'closed' };
    }
    return { status: 'pending' };
  }
}
