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
      throw new SignatureError(`未知平台证书序列号 ${serial}`);
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
      eventType: parsed.event_type === 'REFUND.SUCCESS' ? 'refunded' : 'paid',
    };
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
