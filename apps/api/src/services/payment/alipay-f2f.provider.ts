/**
 * 支付宝当面付（alipay.trade.precreate）
 *
 * 注意：支付宝回调是 application/x-www-form-urlencoded，不是 JSON。
 * 待验串 = 除 sign / sign_type 外，按 key 字典序拼的 k=v&…（用未转义的原始值）。
 */
import { createSign, createVerify } from 'crypto';
import {
  SignatureError,
  type CallbackEvent,
  type CreateOrderInput,
  type PaymentProvider,
  type QueryResult,
} from './types';

export interface AlipayConfig {
  appId: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  gateway: string;
}

/** 分 → 元字符串（支付宝以元为单位，保留两位） */
function fenToYuan(fen: number): string {
  return (fen / 100).toFixed(2);
}

/** 元字符串 → 分，Math.round 避免浮点误差（'0.07' * 100 = 7.000000000000001） */
function yuanToFen(yuan: string): number {
  return Math.round(Number(yuan) * 100);
}

export class AlipayF2FProvider implements PaymentProvider {
  readonly name = 'alipay' as const;

  constructor(private readonly cfg: AlipayConfig) {}

  private sign(params: Record<string, string>): string {
    const s = Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createSign('RSA-SHA256').update(s, 'utf8').sign(this.cfg.appPrivateKey, 'base64');
  }

  private async call(method: string, bizContent: Record<string, unknown>): Promise<Record<string, unknown>> {
    const params: Record<string, string> = {
      app_id: this.cfg.appId,
      method,
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
      version: '1.0',
      notify_url: this.cfg.notifyUrl,
      biz_content: JSON.stringify(bizContent),
    };
    params.sign = this.sign(params);

    const res = await fetch(this.cfg.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
    });
    if (!res.ok) throw new Error(`ALIPAY_HTTP_${res.status}`);
    const json = (await res.json()) as Record<string, Record<string, unknown>>;
    const key = `${method.replace(/\./g, '_')}_response`;
    return json[key] ?? {};
  }

  async createOrder(input: CreateOrderInput): Promise<{ qrCodeUrl: string }> {
    const resp = await this.call('alipay.trade.precreate', {
      out_trade_no: input.outTradeNo,
      total_amount: fenToYuan(input.amountFen),
      subject: input.description,
    });
    const qr = resp.qr_code as string | undefined;
    if (!qr) throw new Error(`ALIPAY_CREATE_ORDER_FAILED: ${JSON.stringify(resp).slice(0, 200)}`);
    return { qrCodeUrl: qr };
  }

  verifyCallback(
    rawBody: Buffer,
    _headers: Record<string, string | undefined>
  ): CallbackEvent {
    const params: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(rawBody.toString('utf8'))) {
      params[k] = v;
    }

    const sign = params.sign;
    if (!sign) throw new SignatureError('支付宝回调缺少 sign');

    if (params.app_id !== this.cfg.appId) {
      throw new SignatureError('支付宝回调 app_id 不匹配');
    }

    const waitSign = Object.keys(params)
      .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');

    const valid = createVerify('RSA-SHA256')
      .update(waitSign, 'utf8')
      .verify(this.cfg.alipayPublicKey, sign, 'base64');
    if (!valid) throw new SignatureError('支付宝回调验签失败');

    const isRefund = params.refund_fee !== undefined && params.refund_fee !== '';
    return {
      outTradeNo: params.out_trade_no,
      providerTransactionId: params.trade_no,
      eventType: isRefund ? 'refunded' : 'paid',
    };
  }

  async queryOrder(outTradeNo: string): Promise<QueryResult> {
    const resp = await this.call('alipay.trade.query', { out_trade_no: outTradeNo });
    const status = resp.trade_status as string | undefined;
    if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') {
      return {
        status: 'success',
        amountFen: yuanToFen(String(resp.total_amount ?? '0')),
        transactionId: resp.trade_no as string,
      };
    }
    if (status === 'TRADE_CLOSED') return { status: 'closed' };
    return { status: 'pending' };
  }
}
