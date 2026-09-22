/**
 * 积分充值 API client — Task 10 Dashboard 充值页
 *
 * 后端响应统一为 { success, data, error, timestamp }（见 apps/api/src/routes/credits.ts
 * 与 credits-orders.ts），本文件的 apiFetch 负责解包，业务函数只关心 data。
 */

export interface Balance {
  balance: number;
  total_recharged: number;
  total_consumed: number;
}

export interface Tier {
  id: string;
  amountFen: number;
  credits: number;
}

export interface Tx {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

export interface CreatedOrder {
  orderId: string;
  qrCodeUrl: string;
  amountFen: number;
  credits: number;
  expireAt: string;
}

export interface SyncOrderResult {
  outcome:
    | 'credited'
    | 'already_credited'
    | 'credit_conflict'
    | 'not_paid'
    | 'amount_mismatch'
    | 'order_not_found'
    // C-2：CAS 未命中但当前状态不是 credited（如订单已过期）——钱可能已收但订单
    // 无法正常结算，前端绝不能当成功处理，需提示用户联系客服人工核查。
    | 'not_settlable';
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error?: { code: string; message: string };
  timestamp: string;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { credentials: 'include', ...init, headers });
  const json = (await res.json().catch(() => ({}))) as Partial<ApiEnvelope<T>>;
  if (!res.ok || json.success !== true) {
    const code = json.error?.code ?? `HTTP_${res.status}`;
    throw new Error(code);
  }
  return json.data as T;
}

export async function fetchBalance(): Promise<Balance> {
  return apiFetch<Balance>('/api/credits/balance');
}

export async function fetchTiers(): Promise<Tier[]> {
  const r = await apiFetch<{ tiers: Tier[] }>('/api/credits/orders/tiers');
  return r.tiers;
}

export async function fetchTransactions(): Promise<Tx[]> {
  const r = await apiFetch<{ transactions: Tx[] }>('/api/credits/transactions?limit=50');
  return r.transactions;
}

export async function createOrder(
  tierId: string,
  provider: 'wechat' | 'alipay'
): Promise<CreatedOrder> {
  return apiFetch<CreatedOrder>('/api/credits/orders', {
    method: 'POST',
    body: JSON.stringify({ tier_id: tierId, provider }),
  });
}

export async function syncOrder(orderId: string): Promise<SyncOrderResult> {
  return apiFetch<SyncOrderResult>(`/api/credits/orders/${orderId}/sync`, {
    method: 'POST',
  });
}
