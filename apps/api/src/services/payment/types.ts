/**
 * 支付领域契约 —— 状态枚举 / CAS 转移表 / 档位 / Provider 接口
 *
 * 铁律：状态枚举与合法前置集合只允许定义一份，所有消费方 import 此处。
 * 手抄副本是隐形炸弹。
 */

export type OrderStatus =
  | 'created'
  | 'pending'
  | 'credited'
  | 'create_failed'
  | 'expired'
  | 'amount_mismatch'
  | 'refund_pending';

/**
 * key = 目标状态，value = 允许转入该状态的前置状态集合。
 * 直接喂给 CAS：UPDATE ... WHERE id=$1 AND status = ANY($2)
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: [],                    // 初始态，不可被转入
  pending: ['created'],
  credited: ['pending'],
  create_failed: ['created'],
  expired: ['pending'],
  amount_mismatch: ['pending'],
  refund_pending: ['credited'],
};

/** 充值档位：金额与积分数一律服务端决定，绝不信客户端传值 */
export const RECHARGE_TIERS = [
  { id: 'tier_100', amountFen: 10_000, credits: 100 },
  { id: 'tier_500', amountFen: 50_000, credits: 550 },
  { id: 'tier_1000', amountFen: 100_000, credits: 1_150 },
] as const satisfies ReadonlyArray<{ id: string; amountFen: number; credits: number }>;

export type RechargeTierId = (typeof RECHARGE_TIERS)[number]['id'];

export function findTier(id: string) {
  return RECHARGE_TIERS.find((t) => t.id === id);
}

/** 订单 30 分钟过期 */
export const ORDER_TTL_MS = 30 * 60 * 1000;

/** 验签失败 —— 必须与业务错误区分，调用方据此返回 403 且不落库 */
export class SignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}

export interface CallbackEvent {
  providerTransactionId: string;
  outTradeNo: string;
  eventType: 'paid' | 'refunded';
}

export interface QueryResult {
  status: 'success' | 'pending' | 'closed';
  amountFen?: number;
  transactionId?: string;
}

export interface CreateOrderInput {
  outTradeNo: string;
  amountFen: number;
  description: string;
  expireAt: Date;
}

export interface PaymentProvider {
  readonly name: 'wechat' | 'alipay' | 'mock';
  createOrder(input: CreateOrderInput): Promise<{ qrCodeUrl: string }>;
  /** 验签失败必须抛 SignatureError；成功返回解析出的事件 */
  verifyCallback(rawBody: Buffer, headers: Record<string, string | undefined>): CallbackEvent;
  queryOrder(outTradeNo: string): Promise<QueryResult>;
}
