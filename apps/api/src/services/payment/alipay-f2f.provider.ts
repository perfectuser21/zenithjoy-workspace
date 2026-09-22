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
  /**
   * 收款方 PID（支付宝官方通知校验清单里 app_id 与 seller_id 是两条独立项）。
   * 校验的是"回调声明的收款账号确实是自己"，防同一 appid 下收款账号被改配（I-9）。
   */
  sellerId: string;
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

    // I-9：seller_id 校验收款方 PID 确实是自己，与 app_id 校验是两条独立项——
    // 防的是同一 appid 下收款账号被改配（官方通知校验清单要求两者都查）。
    if (params.seller_id !== this.cfg.sellerId) {
      throw new SignatureError('支付宝回调 seller_id 不匹配');
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

    // I-3：不能只看 refund_fee 是否存在就判定 paid——超时未付/交易关闭
    // （TRADE_CLOSED 且无 refund_fee）会被误判成已支付。按 trade_status 白名单判定：
    // 有 refund_fee → refunded；TRADE_SUCCESS/TRADE_FINISHED → paid；其余（含
    // TRADE_CLOSED、WAIT_BUYER_PAY 等）→ closed，只记审计不做资金动作。
    const isRefund = params.refund_fee !== undefined && params.refund_fee !== '';
    const eventType: CallbackEvent['eventType'] = isRefund
      ? 'refunded'
      : params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED'
        ? 'paid'
        : 'closed';
    return {
      outTradeNo: params.out_trade_no,
      providerTransactionId: params.trade_no,
      eventType,
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
