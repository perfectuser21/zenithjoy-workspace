/**
 * 假支付网关 —— 用于单测、集成测试与本地开发。
 * 绝不在 production 注册（见 provider-registry）。
 */
import {
  SignatureError,
  type CallbackEvent,
  type CreateOrderInput,
  type PaymentProvider,
  type QueryResult,
} from './types';

export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  private queryResults = new Map<string, QueryResult>();

  async createOrder(input: CreateOrderInput): Promise<{ qrCodeUrl: string }> {
    return { qrCodeUrl: `mock://pay?out_trade_no=${input.outTradeNo}&fen=${input.amountFen}` };
  }

  verifyCallback(
    rawBody: Buffer,
    headers: Record<string, string | undefined>
  ): CallbackEvent {
    if (headers['x-mock-signature'] !== 'valid') {
      throw new SignatureError('mock 签名校验失败');
    }
    const parsed = JSON.parse(rawBody.toString('utf8')) as {
      out_trade_no: string; transaction_id: string; event_type: 'paid' | 'refunded';
    };
    return {
      outTradeNo: parsed.out_trade_no,
      providerTransactionId: parsed.transaction_id,
      eventType: parsed.event_type,
    };
  }

  async queryOrder(outTradeNo: string): Promise<QueryResult> {
    return this.queryResults.get(outTradeNo) ?? { status: 'pending' };
  }

  /** 测试钩子 */
  __setQueryResult(outTradeNo: string, result: QueryResult): void {
    this.queryResults.set(outTradeNo, result);
  }

  /** 测试钩子 */
  __reset(): void {
    this.queryResults.clear();
  }
}
