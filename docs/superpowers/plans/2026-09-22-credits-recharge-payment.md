# 积分自助充值链路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商家在网页 Dashboard 扫微信/支付宝二维码充积分，付款后积分自动到账，并能被「对标分析」功能真实扣掉。

**Architecture:** 新增 `payment_orders` 订单表承载幂等与状态机；`PaymentProvider` 接口隔离三个支付实现（wechat / alipay / mock）；回调路由抢在全局 `express.json()` 之前用 raw body 验签；验签后**不信回调内容**，调平台查单接口拿权威状态，再以「订单 CAS + recharge」同事务入账。

**Tech Stack:** TypeScript / Express / PostgreSQL (node-pg) / vitest / React (dashboard)

## Global Constraints

- 金额一律用**整数分**（`amount_fen`），绝不使用浮点。
- 所有订单状态转移必须是 CAS：`UPDATE ... WHERE id=$1 AND status = ANY($2)`，靠 `rowCount` 判生效。禁止「先 SELECT 判态再 UPDATE」。
- 入账幂等靠 DB 原子声明（UNIQUE 约束 + `INSERT ... ON CONFLICT DO NOTHING`），禁止先查后写。
- 回调路由必须挂在 `apps/api/src/app.ts` 的全局 `express.json()`（当前 line 96）**之前**，使用 `express.raw({ type: '*/*' })`。
- 己方异常（DB 断连、事务失败）时回调必须返回 **5xx**，绝不在未成功入账时返回 200。
- 退款事件**禁止**自动调 `consume` 反扣积分（会撞 `balance>=0` 的 CHECK），一律落 `refund_pending` 等人工。
- PEM 私钥走文件挂载 + `fs.readFileSync`，**绝不写进 env 变量**。
- 新表必带 `tenant_id` 且业务端点走 `tenantContext`。
- 状态枚举与 CAS 合法前置集合**只允许定义一份**，放在 `src/services/payment/types.ts`，所有消费方 import。
- 日志可记 `payment_order_id / tenant_id / amount_fen / status / out_trade_no / 耗时 / HTTP code`；**绝不记**私钥、APIv3 密钥、完整回调 body 原文、openid。
- 单测命令 `npm test -w apps/api`（vitest run），测试放 `apps/api/tests/`，DB 通过 `vi.mock('../../src/db/connection')` 打桩。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `apps/api/db/migrations/20260922_120000_payment_orders.sql` | 订单表 / 回调审计表 / credit_transactions 加 order_id |
| `apps/api/src/services/payment/types.ts` | `PaymentProvider` 接口、状态枚举、CAS 前置集合、档位表（唯一一份常量） |
| `apps/api/src/services/payment/mock.provider.ts` | 测试与本地用的假网关 |
| `apps/api/src/services/payment/wechat-native.provider.ts` | 微信支付 Native |
| `apps/api/src/services/payment/alipay-f2f.provider.ts` | 支付宝当面付 |
| `apps/api/src/services/payment/provider-registry.ts` | 按 name 取 provider，测试可注入 |
| `apps/api/src/services/payment/orders.service.ts` | 建单 / 复用活跃单 / 过期兜底 |
| `apps/api/src/services/payment/settlement.service.ts` | 验签后统一入账（回调与查单共用） |
| `apps/api/src/routes/payment-callback.ts` | 公网回调，raw body |
| `apps/api/src/routes/credits-orders.ts` | 下单 / 主动查单 / 订单列表 |
| `apps/dashboard/src/api/credits.api.ts` | 前端 API 封装 |
| `apps/dashboard/src/pages/CreditsPage.tsx` | 充值页 |
| `.github/workflows/scripts/smoke/payment-smoke.sh` | 回调公网可达 smoke |

**修改**

| 文件 | 改动 |
|---|---|
| `apps/api/src/services/credits.service.ts` | `recharge()` 增 `orderId` 幂等参数 |
| `apps/api/src/app.ts` | 回调路由前置挂载 + 新 router 注册 |
| `apps/api/src/startup-check.ts` | 新增 `REQUIRED_FILE_ENV` 文件类检查 + 支付 env 登记 |
| `apps/api/src/routes/competitor-research.ts` | `POST /start` 挂 `tenantContext` + `createCreditCharger('competitor_research')` |
| `apps/api/src/auth-bridge.ts` | free fallback 事务内补 `initial_grant` 100 积分 |
| `apps/dashboard/src/config/navigation.config.ts` | 菜单项 + 路由表 |
| `apps/dashboard/src/contexts/InstanceContext.tsx` | features 加 `'credits': true` |
| `deploy/docker-compose.staging-api.yml` / `prod-api.yml` | secrets 卷挂载 |

---

### Task 1: 数据库结构

**Files:**
- Create: `apps/api/db/migrations/20260922_120000_payment_orders.sql`
- Test: `apps/api/tests/migrations/payment-orders-schema.test.ts`

**Interfaces:**
- Consumes: 已有 `zenithjoy.tenants`、`zenithjoy.credit_transactions`
- Produces: 表 `zenithjoy.payment_orders`、`zenithjoy.payment_callbacks`；`credit_transactions.order_id` 列

- [ ] **Step 1: 写失败测试**

`apps/api/tests/migrations/payment-orders-schema.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(
  join(__dirname, '../../db/migrations/20260922_120000_payment_orders.sql'),
  'utf8'
);

describe('payment_orders migration', () => {
  it('订单表带 tenant_id 外键（租户隔离铁律）', () => {
    expect(sql).toMatch(/tenant_id\s+UUID\s+NOT NULL\s+REFERENCES\s+zenithjoy\.tenants/i);
  });

  it('amount_fen 是整数且必须为正（禁浮点）', () => {
    expect(sql).toMatch(/amount_fen\s+INTEGER\s+NOT NULL\s+CHECK\s*\(\s*amount_fen\s*>\s*0\s*\)/i);
  });

  it('(provider, out_trade_no) 唯一 — 幂等第一道闸', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*provider\s*,\s*out_trade_no\s*\)/i);
  });

  it('provider_transaction_id 部分唯一索引 — 防同一笔平台交易入账两次', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*payment_orders\s*\(\s*provider\s*,\s*provider_transaction_id\s*\)[\s\S]*WHERE\s+provider_transaction_id\s+IS NOT NULL/i
    );
  });

  it('credit_transactions.order_id 部分唯一索引 — 入账幂等第二道闸', () => {
    expect(sql).toMatch(/ALTER TABLE\s+zenithjoy\.credit_transactions\s+ADD COLUMN[\s\S]*order_id/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*credit_transactions\s*\(\s*order_id\s*\)[\s\S]*WHERE\s+order_id\s+IS NOT NULL/i
    );
  });

  it('payment_callbacks 用 (provider, provider_transaction_id, event_type) 唯一判首次投递', () => {
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*provider\s*,\s*provider_transaction_id\s*,\s*event_type\s*\)/i
    );
  });

  it('只存回调摘要不存原文（日志红线）', () => {
    expect(sql).toMatch(/raw_digest/i);
    expect(sql).not.toMatch(/raw_body/i);
  });

  it('pending 订单有过期扫描索引', () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*payment_orders\s*\(\s*status\s*,\s*expire_at\s*\)[\s\S]*WHERE\s+status\s*=\s*'pending'/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/migrations/payment-orders-schema.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 20260922_120000_payment_orders.sql`

- [ ] **Step 3: 写 migration**

`apps/api/db/migrations/20260922_120000_payment_orders.sql`：

```sql
-- 积分自助充值链路 — 订单表 + 回调审计表 + 入账幂等列
-- 设计文档：docs/superpowers/specs/2026-09-22-credits-recharge-payment-design.md
--
-- 幂等两道闸：
--   ① payment_orders 状态 CAS（pending → credited，rowCount=1 才入账）
--   ② credit_transactions.order_id 部分唯一索引（DB 级兜底）

CREATE TABLE IF NOT EXISTS zenithjoy.payment_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  out_trade_no            TEXT NOT NULL,
  provider                TEXT NOT NULL,
  amount_fen              INTEGER NOT NULL CHECK (amount_fen > 0),
  credits                 INTEGER NOT NULL CHECK (credits > 0),
  status                  TEXT NOT NULL DEFAULT 'created',
  provider_transaction_id TEXT,
  qr_code_url             TEXT,
  expire_at               TIMESTAMPTZ NOT NULL,
  credited_at             TIMESTAMPTZ,
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, out_trade_no)
);

COMMENT ON TABLE zenithjoy.payment_orders IS '充值订单（幂等与状态机载体）';
COMMENT ON COLUMN zenithjoy.payment_orders.amount_fen IS '金额，单位=分，整数，禁浮点';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_txn
  ON zenithjoy.payment_orders (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_tenant
  ON zenithjoy.payment_orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_pending_expire
  ON zenithjoy.payment_orders (status, expire_at)
  WHERE status = 'pending';

-- 回调审计（只存摘要，不存原文 — 日志红线）
CREATE TABLE IF NOT EXISTS zenithjoy.payment_callbacks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  event_type              TEXT NOT NULL,
  order_id                UUID REFERENCES zenithjoy.payment_orders(id) ON DELETE SET NULL,
  raw_digest              TEXT NOT NULL,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id, event_type)
);

COMMENT ON TABLE zenithjoy.payment_callbacks IS '支付回调审计；UNIQUE 用于 ON CONFLICT DO NOTHING 判首次投递';
COMMENT ON COLUMN zenithjoy.payment_callbacks.raw_digest IS '回调体 SHA256，绝不存原文';

-- 入账幂等第二道闸
ALTER TABLE zenithjoy.credit_transactions
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES zenithjoy.payment_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_order
  ON zenithjoy.credit_transactions (order_id)
  WHERE order_id IS NOT NULL;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/migrations/payment-orders-schema.test.ts`
Expected: PASS（8 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/migrations/payment-orders-schema.test.ts
git commit -m "test(credits): payment_orders schema 约束断言（先红）"
git add apps/api/db/migrations/20260922_120000_payment_orders.sql
git commit -m "feat(credits): payment_orders + payment_callbacks + 入账幂等列"
```

---

### Task 2: 支付领域契约（types.ts）

**Files:**
- Create: `apps/api/src/services/payment/types.ts`
- Test: `apps/api/tests/services/payment/types.test.ts`

**Interfaces:**
- Produces:
  - `type OrderStatus = 'created'|'pending'|'credited'|'create_failed'|'expired'|'amount_mismatch'|'refund_pending'`
  - `const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]>` —— key 是**目标状态**，值是合法前置集合，直接喂给 CAS 的 `= ANY($2)`
  - `const RECHARGE_TIERS: ReadonlyArray<{ id: string; amountFen: number; credits: number }>`
  - `interface PaymentProvider { name; createOrder; verifyCallback; queryOrder }`
  - `class SignatureError extends Error`
  - `type CallbackEvent = { providerTransactionId: string; outTradeNo: string; eventType: 'paid'|'refunded'; }`
  - `type QueryResult = { status: 'success'|'pending'|'closed'; amountFen?: number; transactionId?: string }`

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/types.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  RECHARGE_TIERS,
  SignatureError,
  type OrderStatus,
} from '../../../src/services/payment/types';

describe('订单状态机', () => {
  it('credited 只能从 pending 来 —— 防止 created 直接跳到已入账', () => {
    expect(ALLOWED_TRANSITIONS.credited).toEqual(['pending']);
  });

  it('pending 只能从 created 来', () => {
    expect(ALLOWED_TRANSITIONS.pending).toEqual(['created']);
  });

  it('expired 只能从 pending 来 —— 已入账的单不可被标过期', () => {
    expect(ALLOWED_TRANSITIONS.expired).toEqual(['pending']);
  });

  it('refund_pending 只能从 credited 来 —— 没入过账的单不存在退款', () => {
    expect(ALLOWED_TRANSITIONS.refund_pending).toEqual(['credited']);
  });

  it('终态没有任何合法前置（不可被再次转入）', () => {
    expect(ALLOWED_TRANSITIONS.created).toEqual([]);
  });

  it('每个状态都在转移表里登记（防新增状态漏定义）', () => {
    const all: OrderStatus[] = [
      'created', 'pending', 'credited',
      'create_failed', 'expired', 'amount_mismatch', 'refund_pending',
    ];
    for (const s of all) {
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });
});

describe('充值档位', () => {
  it('档位金额与积分均为正整数（分，禁浮点）', () => {
    expect(RECHARGE_TIERS.length).toBeGreaterThan(0);
    for (const t of RECHARGE_TIERS) {
      expect(Number.isInteger(t.amountFen)).toBe(true);
      expect(t.amountFen).toBeGreaterThan(0);
      expect(Number.isInteger(t.credits)).toBe(true);
      expect(t.credits).toBeGreaterThan(0);
    }
  });

  it('档位 id 唯一', () => {
    const ids = RECHARGE_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SignatureError', () => {
  it('是 Error 子类且可被 instanceof 判别', () => {
    const e = new SignatureError('bad sign');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SignatureError);
    expect(e.message).toBe('bad sign');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/types.test.ts`
Expected: FAIL — `Failed to resolve import ".../src/services/payment/types"`

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/types.ts`：

```typescript
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/types.test.ts`
Expected: PASS（9 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/types.test.ts
git commit -m "test(credits): 支付状态机与档位契约断言（先红）"
git add apps/api/src/services/payment/types.ts
git commit -m "feat(credits): 支付领域契约 — 状态机/档位/Provider 接口"
```

---

### Task 3: recharge() 增幂等参数

**Files:**
- Modify: `apps/api/src/services/credits.service.ts`
- Test: `apps/api/tests/services/credits-recharge-idempotent.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `credit_transactions.order_id` 列
- Produces: `recharge(tenantId, amount, reason, metadata?, orderId?)` —— 多一个可选第 5 参数；传了 `orderId` 时把它写进 `credit_transactions.order_id`，命中唯一索引冲突（23505）时抛 `DuplicateCreditError`
- Produces: `class DuplicateCreditError extends Error`

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/credits-recharge-idempotent.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../src/db/connection';
import { recharge, DuplicateCreditError } from '../../src/services/credits.service';

vi.mock('../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client) }, __client: client };
});

const client = (await import('../../src/db/connection') as any).__client;

beforeEach(() => {
  client.query.mockReset();
  client.release.mockReset();
});

describe('recharge 幂等参数', () => {
  it('传 orderId 时写入 credit_transactions.order_id', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    await recharge('t-1', 100, 'recharge', { provider: 'mock' }, 'order-1');

    const txInsert = client.query.mock.calls.find(
      (c: any[]) => /INSERT INTO zenithjoy\.credit_transactions/i.test(c[0])
    );
    expect(txInsert).toBeDefined();
    expect(txInsert[0]).toMatch(/order_id/);
    expect(txInsert[1]).toContain('order-1');
  });

  it('order_id 唯一索引冲突(23505) → 抛 DuplicateCreditError 且已 ROLLBACK', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('ROLLBACK')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      if (/INSERT INTO zenithjoy\.credit_transactions/i.test(sql)) {
        const err: any = new Error('duplicate key');
        err.code = '23505';
        err.constraint = 'idx_credit_tx_order';
        throw err;
      }
      return { rows: [] };
    });

    await expect(
      recharge('t-1', 100, 'recharge', undefined, 'order-dup')
    ).rejects.toBeInstanceOf(DuplicateCreditError);

    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
  });

  it('不传 orderId 时行为与旧版一致（向后兼容）', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 50, total_recharged: 50, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    const r = await recharge('t-2', 50, 'initial_grant');
    expect(r.balance).toBe(50);

    const txInsert = client.query.mock.calls.find(
      (c: any[]) => /INSERT INTO zenithjoy\.credit_transactions/i.test(c[0])
    );
    expect(txInsert[1][4]).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/credits-recharge-idempotent.test.ts`
Expected: FAIL — `DuplicateCreditError` 未导出 / `order_id` 不在 INSERT 语句里

- [ ] **Step 3: 改实现**

在 `apps/api/src/services/credits.service.ts` 中：

① 在 `InsufficientCreditsError` 定义旁新增：

```typescript
/** 同一订单重复入账（命中 credit_transactions.order_id 唯一索引） */
export class DuplicateCreditError extends Error {
  constructor(public readonly orderId: string) {
    super(`DUPLICATE_CREDIT: order ${orderId} 已入过账`);
    this.name = 'DuplicateCreditError';
  }
}
```

② 把 `recharge` 的签名与流水 INSERT 改为：

```typescript
export async function recharge(
  tenantId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>,
  orderId?: string
): Promise<BalanceRow> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`INVALID_AMOUNT: 充值 amount 必须是正整数（得到 ${amount}）`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<BalanceRow>(
      `INSERT INTO zenithjoy.tenant_credits
         (tenant_id, balance, total_recharged, total_consumed, updated_at)
       VALUES ($1, $2, $2, 0, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET balance = zenithjoy.tenant_credits.balance + EXCLUDED.balance,
             total_recharged = zenithjoy.tenant_credits.total_recharged + EXCLUDED.balance,
             updated_at = now()
       RETURNING balance, total_recharged, total_consumed`,
      [tenantId, amount]
    );

    await client.query(
      `INSERT INTO zenithjoy.credit_transactions (tenant_id, amount, reason, metadata, order_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, amount, reason, metadata ? JSON.stringify(metadata) : null, orderId ?? null]
    );

    await client.query('COMMIT');
    const r = rows[0];
    return {
      balance: Number(r.balance),
      total_recharged: Number(r.total_recharged),
      total_consumed: Number(r.total_consumed),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505' && orderId) {
      throw new DuplicateCreditError(orderId);
    }
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: 跑测试确认通过（含旧测试不回归）**

Run: `cd apps/api && npx vitest run tests/services/credits-recharge-idempotent.test.ts tests/services/credits.service.test.ts tests/credits.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/credits-recharge-idempotent.test.ts
git commit -m "test(credits): recharge 幂等参数与重复入账断言（先红）"
git add apps/api/src/services/credits.service.ts
git commit -m "feat(credits): recharge 增 orderId 幂等参数 + DuplicateCreditError"
```

---

### Task 4: MockProvider 与 provider 注册表

**Files:**
- Create: `apps/api/src/services/payment/mock.provider.ts`
- Create: `apps/api/src/services/payment/provider-registry.ts`
- Test: `apps/api/tests/services/payment/mock.provider.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `PaymentProvider` / `SignatureError` / `CallbackEvent` / `QueryResult`
- Produces:
  - `class MockProvider implements PaymentProvider`，含测试钩子 `__setQueryResult(outTradeNo, result)`、`__reset()`
  - `getProvider(name: string): PaymentProvider`（未知 name 抛 `Error('UNKNOWN_PROVIDER')`）
  - `__setProviderForTest(name, provider)`（仅测试用）

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/mock.provider.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../../../src/services/payment/mock.provider';
import { getProvider } from '../../../src/services/payment/provider-registry';
import { SignatureError } from '../../../src/services/payment/types';

describe('MockProvider', () => {
  let p: MockProvider;
  beforeEach(() => { p = new MockProvider(); });

  it('createOrder 返回可用二维码地址', async () => {
    const r = await p.createOrder({
      outTradeNo: 'no-1', amountFen: 10000,
      description: '充值', expireAt: new Date(Date.now() + 60000),
    });
    expect(r.qrCodeUrl).toContain('no-1');
  });

  it('签名头正确时解析出事件', () => {
    const body = Buffer.from(JSON.stringify({
      out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'paid',
    }));
    const ev = p.verifyCallback(body, { 'x-mock-signature': 'valid' });
    expect(ev).toEqual({ outTradeNo: 'no-1', providerTransactionId: 'txn-1', eventType: 'paid' });
  });

  it('签名头缺失或错误时抛 SignatureError（调用方据此返回 403）', () => {
    const body = Buffer.from('{}');
    expect(() => p.verifyCallback(body, {})).toThrow(SignatureError);
    expect(() => p.verifyCallback(body, { 'x-mock-signature': 'bad' })).toThrow(SignatureError);
  });

  it('queryOrder 默认 pending，可被测试钩子改写', async () => {
    expect(await p.queryOrder('no-1')).toEqual({ status: 'pending' });
    p.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    expect(await p.queryOrder('no-1')).toEqual({
      status: 'success', amountFen: 10000, transactionId: 'txn-1',
    });
  });
});

describe('provider-registry', () => {
  it('未知 provider 名抛错，不返回 undefined（防静默走空实现）', () => {
    expect(() => getProvider('paypal')).toThrow('UNKNOWN_PROVIDER');
  });

  it('mock 可取到', () => {
    expect(getProvider('mock').name).toBe('mock');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/mock.provider.test.ts`
Expected: FAIL — 无法解析 `mock.provider` / `provider-registry`

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/mock.provider.ts`：

```typescript
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
```

`apps/api/src/services/payment/provider-registry.ts`：

```typescript
import type { PaymentProvider } from './types';
import { MockProvider } from './mock.provider';

const registry = new Map<string, PaymentProvider>();

registry.set('mock', new MockProvider());

/** 取 provider；未知名字抛错，绝不返回 undefined 让调用方静默走空实现 */
export function getProvider(name: string): PaymentProvider {
  const p = registry.get(name);
  if (!p) throw new Error(`UNKNOWN_PROVIDER: ${name}`);
  return p;
}

/** 仅测试用：注入替身 */
export function __setProviderForTest(name: string, provider: PaymentProvider): void {
  registry.set(name, provider);
}

/** 由 Task 6 在真实 provider 就绪后调用注册 */
export function registerProvider(provider: PaymentProvider): void {
  registry.set(provider.name, provider);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/mock.provider.test.ts`
Expected: PASS（6 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/mock.provider.test.ts
git commit -m "test(credits): MockProvider 与 registry 断言（先红）"
git add apps/api/src/services/payment/mock.provider.ts apps/api/src/services/payment/provider-registry.ts
git commit -m "feat(credits): MockProvider + provider 注册表"
```

---

### Task 5: settlement.service —— 入账核心

这是整条链路最关键的一环：**验签之后、真正加积分之前**的全部判断都在这里。回调路由与主动查单共用它，因此天然幂等。

**Files:**
- Create: `apps/api/src/services/payment/settlement.service.ts`
- Test: `apps/api/tests/services/payment/settlement.service.test.ts`

**Interfaces:**
- Consumes: Task 2 `ALLOWED_TRANSITIONS`；Task 3 的 **`rechargeInTx(client, tenantId, amount, reason, metadata?, orderId?)`**（事务内版本，不是 `recharge`）与 `DuplicateCreditError`；Task 4 `getProvider`
- Produces:
  - `settleOrder(outTradeNo: string, provider: string): Promise<SettleResult>`
  - `type SettleResult = { outcome: 'credited'|'already_credited'|'not_paid'|'amount_mismatch'|'order_not_found' }`
  - `recordCallback(provider, providerTransactionId, eventType, rawDigest, orderId: string | null, tenantId: string | null): Promise<boolean>` —— 返回 `true` 表示首次投递
  - `findOrderByOutTradeNo(provider, outTradeNo): Promise<{ id: string; tenantId: string } | null>` —— 供回调路由在记审计前定位订单，拿到 tenant 归属
  - `markRefundPending(orderId: string): Promise<void>`

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/settlement.service.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

const rechargeMock = vi.fn();
vi.mock('../../../src/services/credits.service', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, rechargeInTx: rechargeMock };
});

import { settleOrder } from '../../../src/services/payment/settlement.service';
import { __setProviderForTest } from '../../../src/services/payment/provider-registry';
import { MockProvider } from '../../../src/services/payment/mock.provider';

const db = await import('../../../src/db/connection') as any;
const client = db.__client;
let mp: MockProvider;

const ORDER = {
  id: 'o-1', tenant_id: 't-1', out_trade_no: 'no-1', provider: 'mock',
  amount_fen: 10000, credits: 100, status: 'pending',
};

beforeEach(() => {
  client.query.mockReset();
  rechargeMock.mockReset().mockResolvedValue({ balance: 100, total_recharged: 100, total_consumed: 0 });
  mp = new MockProvider();
  __setProviderForTest('mock', mp);
});

function mockDb(order: any, casRowCount: number) {
  client.query.mockImplementation(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {};
    if (/SELECT .* FROM zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
      return { rows: casRowCount ? [{ ...order, status: 'credited' }] : [], rowCount: casRowCount };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('settleOrder', () => {
  it('查单成功 + CAS 生效 → 入账一次', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('credited');
    expect(rechargeMock).toHaveBeenCalledTimes(1);
    expect(rechargeMock).toHaveBeenCalledWith(
      client, 't-1', 100, 'recharge',
      expect.objectContaining({ order_id: 'o-1', provider: 'mock' }), 'o-1'
    );
  });

  it('入账必须用 CAS 所在的同一个 client（否则两个独立事务 → 重复入账通道）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    await settleOrder('no-1', 'mock');

    const passedClient = rechargeMock.mock.calls[0][0];
    expect(passedClient).toBe(client);
    // 且 recharge（自带事务的那个）绝不能被用在这条路径上
    expect(client.query.mock.calls.filter((c: any[]) => c[0] === 'BEGIN')).toHaveLength(1);
  });

  it('重复结算：CAS rowCount=0 → 不入账，返回 already_credited', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb({ ...ORDER, status: 'credited' }, 0);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('already_credited');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('金额不符 → 不入账，标 amount_mismatch', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 1, transactionId: 'txn-1' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('amount_mismatch');
    expect(rechargeMock).not.toHaveBeenCalled();
    const upd = client.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('amount_mismatch')
    );
    expect(upd).toBeDefined();
  });

  it('平台说没付 → 不入账，不改状态', async () => {
    mp.__setQueryResult('no-1', { status: 'pending' });
    mockDb(ORDER, 1);

    const r = await settleOrder('no-1', 'mock');

    expect(r.outcome).toBe('not_paid');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('订单不存在 → order_not_found，不抛异常', async () => {
    mockDb(null, 0);
    const r = await settleOrder('nope', 'mock');
    expect(r.outcome).toBe('order_not_found');
    expect(rechargeMock).not.toHaveBeenCalled();
  });

  it('入账抛错 → 事务 ROLLBACK 并向上抛（调用方据此返 5xx 让平台重试）', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    rechargeMock.mockRejectedValue(new Error('db down'));

    await expect(settleOrder('no-1', 'mock')).rejects.toThrow('db down');
    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
  });

  it('CAS 语句用 status = ANY 合法前置集合，不是先查后改', async () => {
    mp.__setQueryResult('no-1', { status: 'success', amountFen: 10000, transactionId: 'txn-1' });
    mockDb(ORDER, 1);
    await settleOrder('no-1', 'mock');

    const cas = client.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders[\s\S]*SET status\s*=\s*'credited'/i.test(c[0])
    );
    expect(cas[0]).toMatch(/status\s*=\s*ANY\(/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/settlement.service.test.ts`
Expected: FAIL — 无法解析 `settlement.service`

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/settlement.service.ts`：

```typescript
/**
 * 结算 —— 回调与主动查单共用的唯一入账路径。
 *
 * 判定点（决策 6afcdcde）：不信回调内容，一律以平台查单结果为准。
 * 幂等：订单状态 CAS（rowCount=1 才入账）+ credit_transactions.order_id 唯一索引兜底。
 */
import pool from '../../db/connection';
import { rechargeInTx } from '../credits.service';
import { getProvider } from './provider-registry';
import { ALLOWED_TRANSITIONS } from './types';

export type SettleOutcome =
  | 'credited'
  | 'already_credited'
  | 'not_paid'
  | 'amount_mismatch'
  | 'order_not_found';

export interface SettleResult {
  outcome: SettleOutcome;
  orderId?: string;
}

interface OrderRow {
  id: string;
  tenant_id: string;
  out_trade_no: string;
  provider: string;
  amount_fen: number;
  credits: number;
  status: string;
}

export async function settleOrder(
  outTradeNo: string,
  providerName: string
): Promise<SettleResult> {
  const provider = getProvider(providerName);

  const found = await pool.query<OrderRow>(
    `SELECT id, tenant_id, out_trade_no, provider, amount_fen, credits, status
       FROM zenithjoy.payment_orders
      WHERE provider = $1 AND out_trade_no = $2`,
    [providerName, outTradeNo]
  );
  const order = found.rows[0];
  if (!order) return { outcome: 'order_not_found' };

  // 权威状态来自平台查单，不是回调体
  const q = await provider.queryOrder(outTradeNo);
  if (q.status !== 'success') {
    return { outcome: 'not_paid', orderId: order.id };
  }

  if (typeof q.amountFen === 'number' && q.amountFen !== order.amount_fen) {
    await pool.query(
      `UPDATE zenithjoy.payment_orders
          SET status = 'amount_mismatch', failure_reason = $2, updated_at = now()
        WHERE id = $1 AND status = ANY($3)`,
      [
        order.id,
        `平台金额 ${q.amountFen} 与订单 ${order.amount_fen} 不符`,
        ALLOWED_TRANSITIONS.amount_mismatch,
      ]
    );
    return { outcome: 'amount_mismatch', orderId: order.id };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cas = await client.query(
      `UPDATE zenithjoy.payment_orders
          SET status = 'credited',
              provider_transaction_id = COALESCE($2, provider_transaction_id),
              credited_at = now(),
              updated_at = now()
        WHERE id = $1 AND status = ANY($3)
      RETURNING id`,
      [order.id, q.transactionId ?? null, ALLOWED_TRANSITIONS.credited]
    );

    if (cas.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { outcome: 'already_credited', orderId: order.id };
    }

    // 必须用 rechargeInTx 而非 recharge：后者自己 connect+BEGIN/COMMIT，
    // 会让「订单状态变更」与「入账」落到两个独立事务——入账已提交而订单回滚时，
    // 重复回调会再次 CAS 成功并重复加积分（两道幂等闸同时失效）。
    await rechargeInTx(
      client,
      order.tenant_id,
      order.credits,
      'recharge',
      {
        order_id: order.id,
        provider: order.provider,
        amount_fen: order.amount_fen,
        out_trade_no: order.out_trade_no,
      },
      order.id
    );

    await client.query('COMMIT');
    return { outcome: 'credited', orderId: order.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 按商户订单号定位订单，供回调路由在记审计前拿到 tenant 归属 */
export async function findOrderByOutTradeNo(
  provider: string,
  outTradeNo: string
): Promise<{ id: string; tenantId: string } | null> {
  const r = await pool.query<{ id: string; tenant_id: string }>(
    `SELECT id, tenant_id FROM zenithjoy.payment_orders
      WHERE provider = $1 AND out_trade_no = $2`,
    [provider, outTradeNo]
  );
  const row = r.rows[0];
  return row ? { id: row.id, tenantId: row.tenant_id } : null;
}

/**
 * 记录回调投递；返回 true 表示首次（ON CONFLICT DO NOTHING 判定，非先查后写）
 *
 * tenantId / orderId 可为 null：伪造或乱序的回调可能对不上任何订单，
 * 这类回调仍要留审计痕迹，故两列可空。
 */
export async function recordCallback(
  provider: string,
  providerTransactionId: string,
  eventType: string,
  rawDigest: string,
  orderId: string | null,
  tenantId: string | null
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO zenithjoy.payment_callbacks
       (provider, provider_transaction_id, event_type, order_id, tenant_id, raw_digest)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, provider_transaction_id, event_type) DO NOTHING
     RETURNING id`,
    [provider, providerTransactionId, eventType, orderId, tenantId, rawDigest]
  );
  return r.rowCount === 1;
}

/** 退款一律落待人工，绝不自动扣回积分（会撞 balance>=0 的 CHECK） */
export async function markRefundPending(orderId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.payment_orders
        SET status = 'refund_pending', updated_at = now()
      WHERE id = $1 AND status = ANY($2)`,
    [orderId, ALLOWED_TRANSITIONS.refund_pending]
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/settlement.service.test.ts`
Expected: PASS（8 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/settlement.service.test.ts
git commit -m "test(credits): 结算幂等/金额校验/回滚断言（先红）"
git add apps/api/src/services/payment/settlement.service.ts
git commit -m "feat(credits): settlement.service — 查单为准 + CAS 幂等入账"
```

---

### Task 6: orders.service —— 建单、复用、过期兜底

**Files:**
- Create: `apps/api/src/services/payment/orders.service.ts`
- Test: `apps/api/tests/services/payment/orders.service.test.ts`

**Interfaces:**
- Consumes: Task 2 `findTier` / `ORDER_TTL_MS` / `ALLOWED_TRANSITIONS`；Task 4 `getProvider`；Task 5 `settleOrder`
- Produces:
  - `createRechargeOrder(tenantId: string, tierId: string, providerName: string): Promise<{ orderId: string; qrCodeUrl: string; expireAt: Date; amountFen: number; credits: number }>`
  - `expireStaleOrders(now?: Date): Promise<{ scanned: number; credited: number; expired: number }>`
  - `class InvalidTierError extends Error`

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/orders.service.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client), query: vi.fn() }, __client: client };
});

const settleMock = vi.fn();
vi.mock('../../../src/services/payment/settlement.service', () => ({
  settleOrder: settleMock,
}));

import {
  createRechargeOrder,
  expireStaleOrders,
  InvalidTierError,
} from '../../../src/services/payment/orders.service';
import { __setProviderForTest } from '../../../src/services/payment/provider-registry';
import { MockProvider } from '../../../src/services/payment/mock.provider';

const db = await import('../../../src/db/connection') as any;
const pool = db.default;
const client = db.__client;

beforeEach(() => {
  pool.query.mockReset();
  client.query.mockReset();
  settleMock.mockReset();
  __setProviderForTest('mock', new MockProvider());
});

describe('createRechargeOrder', () => {
  it('未知档位抛 InvalidTierError（金额由服务端定，不信客户端）', async () => {
    await expect(createRechargeOrder('t-1', 'tier_hacked', 'mock'))
      .rejects.toBeInstanceOf(InvalidTierError);
  });

  it('同租户同档位已有未过期 pending 订单 → 复用，不重复下单', async () => {
    const existing = {
      id: 'o-old', out_trade_no: 'no-old', qr_code_url: 'mock://old',
      expire_at: new Date(Date.now() + 60000), amount_fen: 10000, credits: 100,
    };
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*FROM zenithjoy\.payment_orders[\s\S]*status\s*=\s*'pending'/i.test(sql)) {
        return { rows: [existing], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await createRechargeOrder('t-1', 'tier_100', 'mock');

    expect(r.orderId).toBe('o-old');
    expect(r.qrCodeUrl).toBe('mock://old');
    const inserted = pool.query.mock.calls.some((c: any[]) =>
      /INSERT INTO zenithjoy\.payment_orders/i.test(c[0])
    );
    expect(inserted).toBe(false);
  });

  it('新订单：先落 created，下单成功后 CAS 到 pending 并回填二维码', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-new', out_trade_no: 'no-new' }], rowCount: 1 };
      }
      if (/UPDATE zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-new' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const r = await createRechargeOrder('t-1', 'tier_100', 'mock');

    expect(r.orderId).toBe('o-new');
    expect(r.amountFen).toBe(10000);
    expect(r.credits).toBe(100);
    expect(r.qrCodeUrl).toContain('no-new');

    const cas = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders[\s\S]*'pending'/i.test(c[0])
    );
    expect(cas[0]).toMatch(/status\s*=\s*ANY\(/i);
  });

  it('平台下单失败 → 标 create_failed 并抛错，不留死单', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*status\s*=\s*'pending'/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO zenithjoy\.payment_orders/i.test(sql)) {
        return { rows: [{ id: 'o-fail', out_trade_no: 'no-fail' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const broken = new MockProvider();
    broken.createOrder = async () => { throw new Error('gateway 500'); };
    __setProviderForTest('mock', broken);

    await expect(createRechargeOrder('t-1', 'tier_100', 'mock')).rejects.toThrow('gateway 500');

    const failed = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('create_failed')
    );
    expect(failed).toBeDefined();
  });
});

describe('expireStaleOrders', () => {
  it('过期前先查单：查单说已付 → 入账，不标过期', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return { rows: [{ id: 'o-1', out_trade_no: 'no-1', provider: 'mock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    settleMock.mockResolvedValue({ outcome: 'credited' });

    const r = await expireStaleOrders();

    expect(settleMock).toHaveBeenCalledWith('no-1', 'mock');
    expect(r.credited).toBe(1);
    expect(r.expired).toBe(0);
    const marked = pool.query.mock.calls.some((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('expired')
    );
    expect(marked).toBe(false);
  });

  it('查单说没付 → 才 CAS 标 expired', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return { rows: [{ id: 'o-2', out_trade_no: 'no-2', provider: 'mock' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    settleMock.mockResolvedValue({ outcome: 'not_paid' });

    const r = await expireStaleOrders();

    expect(r.expired).toBe(1);
    const marked = pool.query.mock.calls.find((c: any[]) =>
      /UPDATE zenithjoy\.payment_orders/i.test(c[0]) && String(c[1]).includes('expired')
    );
    expect(marked[0]).toMatch(/status\s*=\s*ANY\(/i);
  });

  it('单个订单结算抛错不影响其余订单继续处理', async () => {
    pool.query.mockImplementation(async (sql: string) => {
      if (/SELECT[\s\S]*expire_at\s*<\s*now\(\)/i.test(sql)) {
        return {
          rows: [
            { id: 'o-a', out_trade_no: 'no-a', provider: 'mock' },
            { id: 'o-b', out_trade_no: 'no-b', provider: 'mock' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    settleMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'not_paid' });

    const r = await expireStaleOrders();

    expect(r.scanned).toBe(2);
    expect(settleMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/orders.service.test.ts`
Expected: FAIL — 无法解析 `orders.service`

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/orders.service.ts`：

```typescript
/**
 * 充值订单 —— 建单 / 复用活跃单 / 过期兜底
 *
 * 金额与积分数一律由服务端档位表决定，绝不采信客户端传值。
 * 过期兜底必须「先查单再标过期」：回调在过期边界丢失是已知场景，
 * 直接标过期会把已付款订单判死，商家钱付了没到账。
 */
import { randomUUID } from 'crypto';
import pool from '../../db/connection';
import { getProvider } from './provider-registry';
import { settleOrder } from './settlement.service';
import { ALLOWED_TRANSITIONS, ORDER_TTL_MS, findTier } from './types';

export class InvalidTierError extends Error {
  constructor(tierId: string) {
    super(`INVALID_TIER: ${tierId}`);
    this.name = 'InvalidTierError';
  }
}

export interface CreatedOrder {
  orderId: string;
  qrCodeUrl: string;
  expireAt: Date;
  amountFen: number;
  credits: number;
}

export async function createRechargeOrder(
  tenantId: string,
  tierId: string,
  providerName: string
): Promise<CreatedOrder> {
  const tier = findTier(tierId);
  if (!tier) throw new InvalidTierError(tierId);

  const provider = getProvider(providerName);

  // 复用未过期的同档位 pending 单：防连点 / 多 tab 重复下单
  const reuse = await pool.query<{
    id: string; out_trade_no: string; qr_code_url: string;
    expire_at: Date; amount_fen: number; credits: number;
  }>(
    `SELECT id, out_trade_no, qr_code_url, expire_at, amount_fen, credits
       FROM zenithjoy.payment_orders
      WHERE tenant_id = $1 AND provider = $2 AND amount_fen = $3
        AND status = 'pending' AND expire_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, providerName, tier.amountFen]
  );
  const old = reuse.rows[0];
  if (old && old.qr_code_url) {
    return {
      orderId: old.id,
      qrCodeUrl: old.qr_code_url,
      expireAt: old.expire_at,
      amountFen: old.amount_fen,
      credits: old.credits,
    };
  }

  const outTradeNo = `ZJ${Date.now()}${randomUUID().slice(0, 8)}`;
  const expireAt = new Date(Date.now() + ORDER_TTL_MS);

  const created = await pool.query<{ id: string; out_trade_no: string }>(
    `INSERT INTO zenithjoy.payment_orders
       (tenant_id, out_trade_no, provider, amount_fen, credits, status, expire_at)
     VALUES ($1, $2, $3, $4, $5, 'created', $6)
     RETURNING id, out_trade_no`,
    [tenantId, outTradeNo, providerName, tier.amountFen, tier.credits, expireAt]
  );
  const orderId = created.rows[0].id;

  let qrCodeUrl: string;
  try {
    const r = await provider.createOrder({
      outTradeNo,
      amountFen: tier.amountFen,
      description: `积分充值 ${tier.credits}`,
      expireAt,
    });
    qrCodeUrl = r.qrCodeUrl;
  } catch (err) {
    await pool.query(
      `UPDATE zenithjoy.payment_orders
          SET status = 'create_failed', failure_reason = $2, updated_at = now()
        WHERE id = $1 AND status = ANY($3)`,
      [orderId, (err as Error).message.slice(0, 200), ALLOWED_TRANSITIONS.create_failed]
    );
    throw err;
  }

  await pool.query(
    `UPDATE zenithjoy.payment_orders
        SET status = 'pending', qr_code_url = $2, updated_at = now()
      WHERE id = $1 AND status = ANY($3)`,
    [orderId, qrCodeUrl, ALLOWED_TRANSITIONS.pending]
  );

  return { orderId, qrCodeUrl, expireAt, amountFen: tier.amountFen, credits: tier.credits };
}

export async function expireStaleOrders(): Promise<{
  scanned: number; credited: number; expired: number;
}> {
  const stale = await pool.query<{ id: string; out_trade_no: string; provider: string }>(
    `SELECT id, out_trade_no, provider
       FROM zenithjoy.payment_orders
      WHERE status = 'pending' AND expire_at < now()
      LIMIT 200`
  );

  let credited = 0;
  let expired = 0;

  for (const o of stale.rows) {
    try {
      // 先查单：回调可能在过期边界丢失
      const r = await settleOrder(o.out_trade_no, o.provider);
      if (r.outcome === 'credited' || r.outcome === 'already_credited') {
        credited += 1;
        continue;
      }
      if (r.outcome === 'amount_mismatch') continue;

      const upd = await pool.query(
        `UPDATE zenithjoy.payment_orders
            SET status = 'expired', updated_at = now()
          WHERE id = $1 AND status = ANY($2)`,
        [o.id, ALLOWED_TRANSITIONS.expired]
      );
      if (upd.rowCount === 1) expired += 1;
    } catch (err) {
      // 单个订单失败不影响其余；留在 pending 下轮再扫
      console.error('[payment] expireStaleOrders 单单失败', {
        payment_order_id: o.id,
        error: (err as Error).message,
      });
    }
  }

  return { scanned: stale.rows.length, credited, expired };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/orders.service.test.ts`
Expected: PASS（7 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/orders.service.test.ts
git commit -m "test(credits): 建单复用/下单失败/过期先查单断言（先红）"
git add apps/api/src/services/payment/orders.service.ts
git commit -m "feat(credits): orders.service — 建单/复用/过期兜底"
```

---

### Task 7: HTTP 层 —— 回调路由（raw body）与下单路由

**Files:**
- Create: `apps/api/src/routes/payment-callback.ts`
- Create: `apps/api/src/routes/credits-orders.ts`
- Modify: `apps/api/src/app.ts`（回调路由**必须**挂在 `express.json()` 之前）
- Test: `apps/api/tests/routes/payment-callback.test.ts`
- Test: `apps/api/tests/routes/app-mount-order.test.ts`

**Interfaces:**
- Consumes: Task 5 `settleOrder` / `recordCallback` / `markRefundPending` / `findOrderByOutTradeNo`；Task 6 `createRechargeOrder` / `InvalidTierError`；Task 4 `getProvider`；已有 `tenantContext`、`simpleRateLimit`

**`SettleOutcome` → HTTP 状态码映射（硬契约，不得靠口头交接）**

Task 5 复审的结论：若接线者按「非 credited 一律 5xx」处理，Task 5 里的自愈逻辑白做、重试风暴照旧。映射必须是：

| outcome | 返回平台 | 理由 |
|---|---|---|
| `credited` | **200** | 正常入账 |
| `already_credited` | **200** | 重复投递，已处理过 |
| `credit_conflict` | **200** | 积分确已入账、订单状态已自愈或待人工；重试解决不了账实分叉，只会刷屏 |
| `amount_mismatch` | **200** | 已标记待人工，重试无意义（金额不会自己变对） |
| `not_paid` | **200** | 平台尚未收款；兜底 job 会继续查，无需平台重推 |
| `order_not_found` | **200** | 对不上订单（伪造/乱序），已留审计；返 5xx 会招来无限重推 |
| **抛异常**（DB 断连等己方故障） | **5xx** | 唯一该让平台重试的情况 |

一句话口径：**只有"我方没处理成功"才 5xx；凡是已经得出结论的业务结果，一律 200。**
- Produces:
  - `paymentCallbackRouter`（`POST /:provider`）
  - `creditsOrdersRouter`（`POST /`、`POST /:id/sync`、`GET /`）

- [ ] **Step 1: 写失败测试**

`apps/api/tests/routes/app-mount-order.test.ts` —— 守住"回调必须在 json 之前"这条约束：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = readFileSync(join(__dirname, '../../src/app.ts'), 'utf8');

describe('app.ts 挂载顺序', () => {
  it('支付回调路由挂在全局 express.json() 之前（APIv3 验签需要原始字节）', () => {
    const callbackIdx = app.indexOf("'/api/payment/callback'");
    const jsonIdx = app.indexOf('express.json(');
    expect(callbackIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(callbackIdx).toBeLessThan(jsonIdx);
  });

  it('回调路由使用 express.raw 而非 json', () => {
    const seg = app.slice(0, app.indexOf('express.json('));
    expect(seg).toMatch(/express\.raw\(/);
  });
});
```

`apps/api/tests/routes/payment-callback.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const settleMock = vi.fn();
const recordMock = vi.fn();
const refundMock = vi.fn();
const findOrderMock = vi.fn();
vi.mock('../../src/services/payment/settlement.service', () => ({
  settleOrder: settleMock,
  recordCallback: recordMock,
  markRefundPending: refundMock,
  findOrderByOutTradeNo: findOrderMock,
}));

import { paymentCallbackRouter } from '../../src/routes/payment-callback';
import { __setProviderForTest } from '../../src/services/payment/provider-registry';
import { MockProvider } from '../../src/services/payment/mock.provider';

function makeApp() {
  const app = express();
  app.use('/api/payment/callback', express.raw({ type: '*/*' }), paymentCallbackRouter);
  return app;
}

const paidBody = JSON.stringify({
  out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'paid',
});

beforeEach(() => {
  settleMock.mockReset().mockResolvedValue({ outcome: 'credited', orderId: 'o-1' });
  recordMock.mockReset().mockResolvedValue(true);
  refundMock.mockReset();
  findOrderMock.mockReset().mockResolvedValue({ id: 'o-1', tenantId: 't-1' });
  __setProviderForTest('mock', new MockProvider());
});

describe('POST /api/payment/callback/:provider', () => {
  it('验签失败 → 403，且不落库不结算', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'bad')
      .send(paidBody);

    expect(res.status).toBe(403);
    expect(recordMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('验签通过 + 首次投递 → 结算并返回 200', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
    expect(settleMock).toHaveBeenCalledWith('no-1', 'mock');
  });

  it('重复投递（recordCallback 返回 false）→ 200 且不重复结算', async () => {
    recordMock.mockResolvedValue(false);

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('己方异常（结算抛错）→ 5xx，绝不返回 200', async () => {
    settleMock.mockRejectedValue(new Error('db down'));

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('退款事件 → 落 refund_pending，不自动扣回积分', async () => {
    const refundBody = JSON.stringify({
      out_trade_no: 'no-1', transaction_id: 'txn-1', event_type: 'refunded',
    });

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(refundBody);

    expect(res.status).toBe(200);
    expect(refundMock).toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it('审计行带上订单与租户归属（租户隔离铁律）', async () => {
    await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(recordMock).toHaveBeenCalledWith(
      'mock', 'txn-1', 'paid', expect.any(String), 'o-1', 't-1'
    );
  });

  it('对不上任何订单的回调仍留审计痕迹，租户与订单列为 null', async () => {
    findOrderMock.mockResolvedValue(null);

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(recordMock).toHaveBeenCalledWith(
      'mock', 'txn-1', 'paid', expect.any(String), null, null
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ['credited'], ['already_credited'], ['credit_conflict'],
    ['amount_mismatch'], ['not_paid'], ['order_not_found'],
  ])('业务结论 %s 一律返 200（重试解决不了已得出结论的事）', async (outcome) => {
    settleMock.mockResolvedValue({ outcome });

    const res = await request(makeApp())
      .post('/api/payment/callback/mock')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', 'valid')
      .send(paidBody);

    expect(res.status).toBe(200);
  });

  it('未知 provider → 404，不抛未捕获异常', async () => {
    const res = await request(makeApp())
      .post('/api/payment/callback/paypal')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(404);
  });
});
```

> 若 `supertest` 尚未在 `apps/api` 的 devDependencies 中，本 task 的 Step 3 先执行 `npm i -D supertest @types/supertest -w apps/api`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/routes/payment-callback.test.ts tests/routes/app-mount-order.test.ts`
Expected: FAIL — 无法解析 `payment-callback`；挂载顺序断言找不到 `'/api/payment/callback'`

- [ ] **Step 3: 写实现**

`apps/api/src/routes/payment-callback.ts`：

```typescript
/**
 * 支付回调 —— 公网端点，无 tenantContext，验签即鉴权。
 *
 * 铁律：
 *   - 必须挂在全局 express.json() 之前，用 express.raw 保留原始字节（验签依赖）
 *   - 己方异常一律返回 5xx 让平台重试；绝不在未成功入账时返回 200
 *   - 只记 out_trade_no / status / 验签结果，不记回调原文
 */
import { createHash } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getProvider } from '../services/payment/provider-registry';
import {
  findOrderByOutTradeNo,
  markRefundPending,
  recordCallback,
  settleOrder,
} from '../services/payment/settlement.service';
import { SignatureError } from '../services/payment/types';

export const paymentCallbackRouter = Router();

paymentCallbackRouter.post('/:provider', async (req: Request, res: Response) => {
  const providerName = req.params.provider;

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    res.status(404).json({ code: 'UNKNOWN_PROVIDER' });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''));

  let event;
  try {
    event = provider.verifyCallback(rawBody, req.headers as Record<string, string | undefined>);
  } catch (err) {
    if (err instanceof SignatureError) {
      console.warn('[payment] 回调验签失败', { provider: providerName });
      res.status(403).json({ code: 'SIGNATURE_INVALID' });
      return;
    }
    console.error('[payment] 回调解析失败', { provider: providerName });
    res.status(400).json({ code: 'MALFORMED_CALLBACK' });
    return;
  }

  const digest = createHash('sha256').update(rawBody).digest('hex');

  try {
    // 先定位订单：审计行要带上 tenant 归属（租户隔离铁律）。
    // 对不上任何订单的回调（伪造 / 乱序）仍要记审计，此时两列为 null。
    const order = await findOrderByOutTradeNo(providerName, event.outTradeNo);

    const first = await recordCallback(
      providerName,
      event.providerTransactionId,
      event.eventType,
      digest,
      order?.id ?? null,
      order?.tenantId ?? null
    );
    if (!first) {
      // 重复投递：已处理过，直接确认，避免平台无限重推
      res.status(200).json({ code: 'SUCCESS', note: 'duplicate' });
      return;
    }

    if (event.eventType === 'refunded') {
      // 退款绝不自动扣回积分（会撞 balance>=0 的 CHECK），落待人工
      if (order) await markRefundPending(order.id);
      console.warn('[payment] 收到退款回调，已落 refund_pending 待人工', {
        provider: providerName, out_trade_no: event.outTradeNo,
      });
      res.status(200).json({ code: 'SUCCESS' });
      return;
    }

    // 所有业务结论一律 200（含 credit_conflict / amount_mismatch / not_paid /
    // order_not_found）——见本 task 的 outcome→HTTP 映射表。只有抛异常才 5xx。
    const result = await settleOrder(event.outTradeNo, providerName);
    console.info('[payment] 回调结算完成', {
      provider: providerName, out_trade_no: event.outTradeNo, outcome: result.outcome,
    });
    res.status(200).json({ code: 'SUCCESS' });
  } catch (err) {
    // 己方问题：必须让平台重试
    console.error('[payment] 回调处理失败，返回 5xx 请求平台重试', {
      provider: providerName, out_trade_no: event.outTradeNo,
      error: (err as Error).message,
    });
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  }
});
```

`apps/api/src/routes/credits-orders.ts`：

```typescript
/**
 * 充值订单 —— 商家自助端点（与 super-admin 的 /api/credits/recharge 区分）
 */
import { Router, type Request, type Response } from 'express';
import { tenantContext } from '../middleware/tenant-context';
import { simpleRateLimit } from '../middleware/simple-rate-limit';
import {
  createRechargeOrder,
  InvalidTierError,
} from '../services/payment/orders.service';
import { settleOrder } from '../services/payment/settlement.service';
import { RECHARGE_TIERS } from '../services/payment/types';
import pool from '../db/connection';

export const creditsOrdersRouter = Router();

const ok = (data: unknown) => ({ success: true, data, timestamp: new Date().toISOString() });
const fail = (code: string, message: string) => ({
  success: false, data: null, error: { code, message }, timestamp: new Date().toISOString(),
});

/** 仅 owner / admin 可充值（涉及花钱） */
function requireBillingRole(req: Request, res: Response, next: () => void): void {
  const role = (req as Request & { tenantRole?: string }).tenantRole;
  if (role !== 'owner' && role !== 'admin') {
    res.status(403).json(fail('FORBIDDEN', '仅企业 owner / admin 可发起充值'));
    return;
  }
  next();
}

creditsOrdersRouter.get('/tiers', tenantContext, (_req, res) => {
  res.json(ok({ tiers: RECHARGE_TIERS }));
});

creditsOrdersRouter.post(
  '/',
  tenantContext,
  requireBillingRole,
  simpleRateLimit({ windowMs: 60_000, max: 10 }),
  async (req: Request, res: Response) => {
    const { tier_id: tierId, provider } = req.body ?? {};
    if (typeof tierId !== 'string' || typeof provider !== 'string') {
      res.status(400).json(fail('INVALID_INPUT', 'tier_id 与 provider 必填'));
      return;
    }
    try {
      const order = await createRechargeOrder(req.tenantId as string, tierId, provider);
      res.json(ok(order));
    } catch (err) {
      if (err instanceof InvalidTierError) {
        res.status(400).json(fail('INVALID_TIER', '未知充值档位'));
        return;
      }
      console.error('[payment] 下单失败', { error: (err as Error).message });
      res.status(502).json(fail('CREATE_ORDER_FAILED', '生成二维码失败，请重试'));
    }
  }
);

/** 商家点「我已支付」→ 主动查单，复用同一结算路径（天然幂等） */
creditsOrdersRouter.post('/:id/sync', tenantContext, async (req: Request, res: Response) => {
  const r = await pool.query<{ out_trade_no: string; provider: string }>(
    `SELECT out_trade_no, provider FROM zenithjoy.payment_orders
      WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, req.tenantId]
  );
  const row = r.rows[0];
  if (!row) {
    res.status(404).json(fail('ORDER_NOT_FOUND', '订单不存在'));
    return;
  }
  try {
    const result = await settleOrder(row.out_trade_no, row.provider);
    res.json(ok({ outcome: result.outcome }));
  } catch (err) {
    console.error('[payment] 主动查单失败', { error: (err as Error).message });
    res.status(502).json(fail('SYNC_FAILED', '确认中，请稍后刷新'));
  }
});

creditsOrdersRouter.get('/', tenantContext, async (req: Request, res: Response) => {
  const r = await pool.query(
    `SELECT id, out_trade_no, provider, amount_fen, credits, status, created_at, credited_at
       FROM zenithjoy.payment_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [req.tenantId]
  );
  res.json(ok({ orders: r.rows }));
});
```

`apps/api/src/app.ts` 修改 —— 在 `app.use(express.json({ limit: '1mb' }))`（当前 line 96）**之前**插入：

```typescript
// 支付回调必须在 express.json() 之前挂载：
// APIv3 验签基于原始字节，body 被解析后无法还原签名串（同 better-auth 的理由）
app.use(
  '/api/payment/callback',
  express.raw({ type: '*/*' }),
  paymentCallbackRouter
);
```

并在文件顶部 import 区加：

```typescript
import { paymentCallbackRouter } from './routes/payment-callback';
import { creditsOrdersRouter } from './routes/credits-orders';
```

在已有 `app.use('/api/credits', creditsRouter);` 一行**之后**加：

```typescript
app.use('/api/credits/orders', creditsOrdersRouter);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/routes/payment-callback.test.ts tests/routes/app-mount-order.test.ts`
Expected: PASS（16 passed —— 回调 8 条 + outcome→HTTP 映射 6 条 + 挂载顺序 2 条）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/routes/payment-callback.test.ts apps/api/tests/routes/app-mount-order.test.ts
git commit -m "test(credits): 回调验签/幂等/5xx 与挂载顺序断言（先红）"
git add apps/api/src/routes/payment-callback.ts apps/api/src/routes/credits-orders.ts apps/api/src/app.ts
git commit -m "feat(credits): 支付回调(raw body 前置挂载) + 自助下单路由"
```

---

### Task 8: 真实 Provider —— 微信 Native 与支付宝当面付

不引入第三方支付 SDK，用 node 内置 `crypto` 手写签名与验签：依赖面更小，行为完全可控，且验签逻辑可用自签自验的密钥对在 CI 里测透——**不需要真实商户号**。

**Files:**
- Create: `apps/api/src/services/payment/wechat-native.provider.ts`
- Create: `apps/api/src/services/payment/alipay-f2f.provider.ts`
- Modify: `apps/api/src/services/payment/provider-registry.ts`（mock 改为非 production 才注册 + 真实 provider 按 env 条件注册）
- Modify: `apps/api/tests/services/payment/mock.provider.test.ts`（补一条 production 不注册 mock 的断言）
- Test: `apps/api/tests/services/payment/wechat-native.provider.test.ts`
- Test: `apps/api/tests/services/payment/alipay-f2f.provider.test.ts`

**Interfaces:**
- Consumes: Task 2 `PaymentProvider` / `SignatureError`
- Produces: `class WechatNativeProvider implements PaymentProvider`、`class AlipayF2FProvider implements PaymentProvider`，两者构造函数都接收显式配置对象（便于测试注入），不在类内部直接读 `process.env`

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/wechat-native.provider.test.ts`：

```typescript
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
    const ts = '1700000000';
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
    const ts = '1700000000';
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
    const ts = '1700000000';
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
    const ts = '1700000000';
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
```

`apps/api/tests/services/payment/alipay-f2f.provider.test.ts`：

```typescript
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
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/wechat-native.provider.test.ts tests/services/payment/alipay-f2f.provider.test.ts`
Expected: FAIL — 无法解析两个 provider 模块

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/wechat-native.provider.ts`：

```typescript
/**
 * 微信支付 Native（APIv3）
 *
 * 验签规则：待验串 = `${timestamp}\n${nonce}\n${body}\n`，
 * 用 Wechatpay-Serial 指定的平台证书公钥做 RSA-SHA256 验签。
 * 平台公钥由外部注入（来自挂载的证书文件），本类不读 env、不读盘。
 */
import { createSign, createVerify, randomUUID } from 'crypto';
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createDecipheriv } = require('crypto') as typeof import('crypto');
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
```

`apps/api/src/services/payment/alipay-f2f.provider.ts`：

```typescript
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

/** 元字符串 → 分 */
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
```

`apps/api/src/services/payment/provider-registry.ts` 的两处改动：

**① 把 mock 的无条件注册改为按环境注册**（Task 4 评审发现：文件注释承诺"绝不在 production 注册"，但代码是模块级无条件 `registry.set('mock', ...)`，承诺与代码对不上。生产环境据此可创建永远 pending 的 mock 订单，污染数据并触发积压告警）：

```typescript
// 原：registry.set('mock', new MockProvider());
// 改为：
if (process.env.NODE_ENV !== 'production') {
  registry.set('mock', new MockProvider());
}
```

对应补一条测试进 `apps/api/tests/services/payment/mock.provider.test.ts` 的 `provider-registry` describe：

```typescript
  it('production 环境不注册 mock（防止生产下单到假网关）', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { getProvider: freshGetProvider } = await import(
      '../../../src/services/payment/provider-registry'
    );
    expect(() => freshGetProvider('mock')).toThrow('UNKNOWN_PROVIDER');
    process.env.NODE_ENV = prev;
    vi.resetModules();
  });
```

**② 追加真实 provider 的条件注册**（放在文件末尾）：

```typescript
/**
 * 真实 provider 按需注册：缺凭据时不注册，getProvider 会抛 UNKNOWN_PROVIDER，
 * 好过注册一个半残实例在运行时炸。
 */
export function registerRealProvidersFromEnv(): void {
  const {
    WX_PAY_MCHID, WX_PAY_SERIAL_NO, WX_PAY_V3_KEY,
    WX_PAY_PRIVATE_KEY_PATH, WX_PAY_PLATFORM_CERT_PATH,
    WX_PAY_APPID, PAYMENT_NOTIFY_BASE_URL,
    ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_PATH, ALIPAY_PUBLIC_KEY_PATH, ALIPAY_GATEWAY,
  } = process.env;

  if (
    WX_PAY_MCHID && WX_PAY_SERIAL_NO && WX_PAY_V3_KEY &&
    WX_PAY_PRIVATE_KEY_PATH && WX_PAY_PLATFORM_CERT_PATH &&
    WX_PAY_APPID && PAYMENT_NOTIFY_BASE_URL
  ) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    const { WechatNativeProvider } = require('./wechat-native.provider');
    registry.set('wechat', new WechatNativeProvider({
      mchId: WX_PAY_MCHID,
      serialNo: WX_PAY_SERIAL_NO,
      apiV3Key: WX_PAY_V3_KEY,
      merchantPrivateKey: readFileSync(WX_PAY_PRIVATE_KEY_PATH, 'utf8'),
      platformPublicKeys: JSON.parse(readFileSync(WX_PAY_PLATFORM_CERT_PATH, 'utf8')),
      notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/wechat`,
      appId: WX_PAY_APPID,
    }));
  }

  if (ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY_PATH && ALIPAY_PUBLIC_KEY_PATH && PAYMENT_NOTIFY_BASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    const { AlipayF2FProvider } = require('./alipay-f2f.provider');
    registry.set('alipay', new AlipayF2FProvider({
      appId: ALIPAY_APP_ID,
      appPrivateKey: readFileSync(ALIPAY_PRIVATE_KEY_PATH, 'utf8'),
      alipayPublicKey: readFileSync(ALIPAY_PUBLIC_KEY_PATH, 'utf8'),
      notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/alipay`,
      gateway: ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
    }));
  }
}
```

并在 `apps/api/src/index.ts` 启动处（`startupCheck()` 之后）调用一次 `registerRealProvidersFromEnv()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/`
Expected: PASS（wechat 6 + alipay 4 + 前序全部）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/wechat-native.provider.test.ts apps/api/tests/services/payment/alipay-f2f.provider.test.ts
git commit -m "test(credits): 微信/支付宝验签(含篡改/重放/app_id 不符)断言（先红）"
git add apps/api/src/services/payment/wechat-native.provider.ts apps/api/src/services/payment/alipay-f2f.provider.ts apps/api/src/services/payment/provider-registry.ts apps/api/src/index.ts
git commit -m "feat(credits): 微信 Native + 支付宝当面付 provider"
```

---

### Task 9: 消费接入与注册送积分

**Files:**
- Modify: `apps/api/src/routes/competitor-research.ts`（`POST /start` 挂 tenantContext + charger）
- Modify: `apps/api/src/auth-bridge.ts`（free fallback 事务内补 initial_grant）
- Test: `apps/api/tests/routes/competitor-research-credit.test.ts`
- Test: `apps/api/tests/auth-bridge-initial-grant.test.ts`

**Interfaces:**
- Consumes: 已有 `createCreditCharger`、`CREDIT_COSTS.competitor_research = 10`、Task 3 的 `recharge`
- Produces: 无新导出；行为变更

> 说明：`CREDIT_COSTS.ai_writing` 对应的功能在本仓库不存在（dashboard 无入口、api 无端点），本 task **不接入它**，常量保留。

- [ ] **Step 1: 写失败测试**

`apps/api/tests/routes/competitor-research-credit.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../../src/routes/competitor-research.ts'), 'utf8');

describe('对标分析接入积分扣减', () => {
  it('POST /start 挂了 createCreditCharger("competitor_research")', () => {
    expect(src).toMatch(/createCreditCharger\(\s*['"]competitor_research['"]\s*\)/);
  });

  it('charger 必须挂在 tenantContext 之后（否则拿不到 req.tenantId）', () => {
    const startLine = src.match(/router\.post\(\s*['"]\/start['"][\s\S]{0,300}?\)/);
    expect(startLine).not.toBeNull();
    const seg = startLine![0];
    const tenantIdx = seg.indexOf('tenantContext');
    const chargerIdx = seg.indexOf('createCreditCharger');
    expect(tenantIdx).toBeGreaterThan(-1);
    expect(chargerIdx).toBeGreaterThan(tenantIdx);
  });
});
```

`apps/api/tests/auth-bridge-initial-grant.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../src/auth-bridge.ts'), 'utf8');

describe('注册送积分', () => {
  it('free fallback 路径调用了 recharge 且 reason 为 initial_grant', () => {
    expect(src).toMatch(/initial_grant/);
    expect(src).toMatch(/recharge\(/);
  });

  it('赠送额度为 100', () => {
    expect(src).toMatch(/INITIAL_GRANT_CREDITS\s*=\s*100/);
  });

  it('入账失败不阻断注册（有 try/catch 包裹）', () => {
    const idx = src.indexOf('initial_grant');
    const around = src.slice(Math.max(0, idx - 600), idx + 600);
    expect(around).toMatch(/try\s*{/);
    expect(around).toMatch(/catch/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/routes/competitor-research-credit.test.ts tests/auth-bridge-initial-grant.test.ts`
Expected: FAIL — 两个源文件里都还没有对应调用

- [ ] **Step 3: 改实现**

`apps/api/src/routes/competitor-research.ts`：顶部加 import，并把 `POST /start` 的中间件链补全。

```typescript
import { tenantContext } from '../middleware/tenant-context';
import { createCreditCharger } from '../middleware/credit-charge';

// 原：router.post('/start', (req: Request, res: Response) => {
router.post(
  '/start',
  tenantContext,
  createCreditCharger('competitor_research'),
  (req: Request, res: Response) => {
    // …原有 handler 主体保持不变…
  }
);
```

`apps/api/src/auth-bridge.ts`：在 free fallback 建完 tenant 之后补赠送。

```typescript
import { recharge } from './services/credits.service';

/** 新租户注册赠送积分数（产品决策 2026-04-29，本次才真正接线） */
const INITIAL_GRANT_CREDITS = 100;

// …在 free fallback 成功拿到 tenantId 之后：
try {
  await recharge(tenantId, INITIAL_GRANT_CREDITS, 'initial_grant', {
    source: 'auth-bridge-free-fallback',
  });
} catch (err) {
  // 赠送失败不阻断注册：用户仍应能登录，余额可由运营补发
  console.error('[credits] initial_grant 赠送失败', {
    tenant_id: tenantId,
    error: (err as Error).message,
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/routes/competitor-research-credit.test.ts tests/auth-bridge-initial-grant.test.ts && npx vitest run`
Expected: 新测试 PASS，全量测试无回归

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/routes/competitor-research-credit.test.ts apps/api/tests/auth-bridge-initial-grant.test.ts
git commit -m "test(credits): 对标分析扣减与注册送积分断言（先红）"
git add apps/api/src/routes/competitor-research.ts apps/api/src/auth-bridge.ts
git commit -m "feat(credits): 对标分析接入扣减 + 注册赠送 100 积分"
```

---

### Task 10: Dashboard 充值页（三件套缺一不可）

**Files:**
- Create: `apps/dashboard/src/api/credits.api.ts`
- Create: `apps/dashboard/src/pages/CreditsPage.tsx`
- Modify: `apps/dashboard/src/config/navigation.config.ts`（菜单项 + 路由表）
- Modify: `apps/dashboard/src/contexts/InstanceContext.tsx`（features 加 `credits`）
- Test: `apps/dashboard/src/pages/__tests__/CreditsPage.test.tsx`
- Test: `apps/dashboard/src/config/__tests__/credits-nav.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `GET /api/credits/orders/tiers`、`POST /api/credits/orders`、`POST /api/credits/orders/:id/sync`、已有 `GET /api/credits/balance`、`GET /api/credits/transactions`
- Produces: 无（叶子页面）

> **铁律**：新页三件套（菜单项 / 路由表 / InstanceContext features）缺任意一件，菜单会静默不显示且无报错。下面的 nav 测试就是守这条。

- [ ] **Step 1: 写失败测试**

`apps/dashboard/src/config/__tests__/credits-nav.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const navSrc = readFileSync(join(__dirname, '../navigation.config.ts'), 'utf8');
const ctxSrc = readFileSync(join(__dirname, '../../contexts/InstanceContext.tsx'), 'utf8');

describe('充值页三件套', () => {
  it('① 菜单项已注册且带 featureKey', () => {
    expect(navSrc).toMatch(/path:\s*'\/credits'[\s\S]{0,200}featureKey:\s*'credits'/);
  });

  it('② 路由表已注册 CreditsPage 且要求登录', () => {
    expect(navSrc).toMatch(
      /{\s*path:\s*'\/credits',\s*component:\s*'CreditsPage',\s*requireAuth:\s*true\s*}/
    );
  });

  it('③ InstanceContext features 含 credits（漏掉这条菜单会静默消失）', () => {
    expect(ctxSrc).toMatch(/'credits':\s*true/);
  });
});
```

`apps/dashboard/src/pages/__tests__/CreditsPage.test.tsx`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CreditsPage from '../CreditsPage';
import * as api from '../../api/credits.api';

vi.mock('../../api/credits.api');

beforeEach(() => {
  vi.mocked(api.fetchBalance).mockResolvedValue({
    balance: 250, total_recharged: 500, total_consumed: 250,
  });
  vi.mocked(api.fetchTiers).mockResolvedValue([
    { id: 'tier_100', amountFen: 10000, credits: 100 },
  ]);
  vi.mocked(api.fetchTransactions).mockResolvedValue([
    { id: 'tx-1', amount: 100, reason: 'recharge', created_at: '2026-09-22T10:00:00Z' },
  ]);
  vi.mocked(api.createOrder).mockResolvedValue({
    orderId: 'o-1', qrCodeUrl: 'https://pay.example/qr', amountFen: 10000,
    credits: 100, expireAt: new Date(Date.now() + 60000).toISOString(),
  });
  vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'not_paid' });
});

describe('CreditsPage', () => {
  it('展示当前余额', async () => {
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText('250')).toBeInTheDocument());
  });

  it('选档位下单后显示二维码', async () => {
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() =>
      expect(screen.getByAltText('支付二维码')).toHaveAttribute(
        'src', expect.stringContaining('pay.example')
      )
    );
  });

  it('点「我已支付」触发主动查单', async () => {
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() => screen.getByAltText('支付二维码'));
    fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));
    await waitFor(() => expect(api.syncOrder).toHaveBeenCalledWith('o-1'));
  });

  it('查单返回 credited 时刷新余额并提示成功', async () => {
    vi.mocked(api.syncOrder).mockResolvedValue({ outcome: 'credited' });
    vi.mocked(api.fetchBalance)
      .mockResolvedValueOnce({ balance: 250, total_recharged: 500, total_consumed: 250 })
      .mockResolvedValue({ balance: 350, total_recharged: 600, total_consumed: 250 });

    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() => screen.getByAltText('支付二维码'));
    fireEvent.click(screen.getByRole('button', { name: /我已支付/ }));

    await waitFor(() => expect(screen.getByText('充值成功')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('350')).toBeInTheDocument());
  });

  it('下单失败显示可重试提示', async () => {
    vi.mocked(api.createOrder).mockRejectedValue(new Error('CREATE_ORDER_FAILED'));
    render(<CreditsPage />);
    await waitFor(() => screen.getByText(/100 积分/));
    fireEvent.click(screen.getByText(/100 积分/));
    fireEvent.click(screen.getByRole('button', { name: /微信支付/ }));
    await waitFor(() =>
      expect(screen.getByText('生成二维码失败，请重试')).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/config/__tests__/credits-nav.test.ts src/pages/__tests__/CreditsPage.test.tsx`
Expected: FAIL — 三件套断言全红；`CreditsPage` 模块不存在

- [ ] **Step 3: 写实现**

`apps/dashboard/src/api/credits.api.ts`：

```typescript
import { apiFetch } from './instance.api';

export interface Balance { balance: number; total_recharged: number; total_consumed: number; }
export interface Tier { id: string; amountFen: number; credits: number; }
export interface Tx { id: string; amount: number; reason: string; created_at: string; }
export interface CreatedOrder {
  orderId: string; qrCodeUrl: string; amountFen: number; credits: number; expireAt: string;
}

export async function fetchBalance(): Promise<Balance> {
  const r = await apiFetch('/api/credits/balance');
  return r.data;
}

export async function fetchTiers(): Promise<Tier[]> {
  const r = await apiFetch('/api/credits/orders/tiers');
  return r.data.tiers;
}

export async function fetchTransactions(): Promise<Tx[]> {
  const r = await apiFetch('/api/credits/transactions?limit=50');
  return r.data.transactions;
}

export async function createOrder(tierId: string, provider: 'wechat' | 'alipay'): Promise<CreatedOrder> {
  const r = await apiFetch('/api/credits/orders', {
    method: 'POST',
    body: JSON.stringify({ tier_id: tierId, provider }),
  });
  if (!r.success) throw new Error(r.error?.code ?? 'CREATE_ORDER_FAILED');
  return r.data;
}

export async function syncOrder(orderId: string): Promise<{ outcome: string }> {
  const r = await apiFetch(`/api/credits/orders/${orderId}/sync`, { method: 'POST' });
  return r.data;
}
```

> 若 `instance.api.ts` 未导出 `apiFetch`，改用该文件中已有的请求封装函数名，保持与 `license.api.ts` 一致。

`apps/dashboard/src/pages/CreditsPage.tsx`：实现「余额卡 + 档位选择 + 渠道按钮 + 二维码 + 倒计时 + 我已支付 + 流水表」，关键行为：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOrder, fetchBalance, fetchTiers, fetchTransactions, syncOrder,
  type Balance, type CreatedOrder, type Tier, type Tx,
} from '../api/credits.api';

export default function CreditsPage() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    setBalance(await fetchBalance());
    setTxs(await fetchTransactions());
  }, []);

  useEffect(() => {
    void reload();
    void fetchTiers().then(setTiers);
  }, [reload]);

  const check = useCallback(async (orderId: string) => {
    const r = await syncOrder(orderId);
    if (r.outcome === 'credited' || r.outcome === 'already_credited') {
      setMessage('充值成功');
      setOrder(null);
      if (timer.current) clearInterval(timer.current);
      await reload();
    }
  }, [reload]);

  // 轮询：页面隐藏时暂停，避免后台标签空转
  useEffect(() => {
    if (!order) return;
    timer.current = setInterval(() => {
      if (document.visibilityState === 'visible') void check(order.orderId);
    }, 5000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [order, check]);

  async function pay(provider: 'wechat' | 'alipay') {
    if (!selected) return;
    setMessage(null);
    try {
      setOrder(await createOrder(selected, provider));
    } catch {
      setMessage('生成二维码失败，请重试');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <section>
        <h1 className="text-xl font-semibold">积分充值</h1>
        <p className="text-3xl mt-2">{balance?.balance ?? '—'}</p>
        <p className="text-sm text-muted-foreground">当前可用积分</p>
      </section>

      <section className="flex gap-3 flex-wrap">
        {tiers.map((t) => (
          <button
            key={t.id}
            onClick={() => setSelected(t.id)}
            className={selected === t.id ? 'border-2 border-primary p-4 rounded' : 'border p-4 rounded'}
          >
            {t.credits} 积分 · ¥{(t.amountFen / 100).toFixed(2)}
          </button>
        ))}
      </section>

      <section className="flex gap-3">
        <button onClick={() => pay('wechat')} disabled={!selected}>微信支付</button>
        <button onClick={() => pay('alipay')} disabled={!selected}>支付宝</button>
      </section>

      {message && <p>{message}</p>}

      {order && (
        <section className="space-y-2">
          <img
            alt="支付二维码"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(order.qrCodeUrl)}`}
          />
          <p className="text-sm">请使用手机扫码支付 ¥{(order.amountFen / 100).toFixed(2)}</p>
          <button onClick={() => void check(order.orderId)}>我已支付</button>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-2">积分流水</h2>
        <table className="w-full text-sm">
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>{t.reason}</td>
                <td className={t.amount > 0 ? 'text-green-600' : 'text-red-600'}>
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

> 二维码图片源若受 CSP 限制，改用仓库已有的前端二维码组件（`grep -rn "qrcode" apps/dashboard/src` 查现成实现），保持 `alt="支付二维码"` 不变以满足测试。

三件套改动：

① `navigation.config.ts` 菜单项数组内（「设置」项旁）加：
```typescript
{ path: '/credits', icon: Coins, label: '积分充值', featureKey: 'credits', component: 'CreditsPage' },
```
并在顶部 `lucide-react` import 中加入 `Coins`。

② `navigation.config.ts` 路由表内（`/license` 那行旁）加：
```typescript
{ path: '/credits', component: 'CreditsPage', requireAuth: true },
```

③ `InstanceContext.tsx` 的 features 映射内加：
```typescript
'credits': true,             // 积分充值页
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/dashboard && npx vitest run src/config/__tests__/credits-nav.test.ts src/pages/__tests__/CreditsPage.test.tsx`
Expected: PASS（3 + 5 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/dashboard/src/config/__tests__/credits-nav.test.ts apps/dashboard/src/pages/__tests__/CreditsPage.test.tsx
git commit -m "test(credits): 充值页三件套与交互断言（先红）"
git add apps/dashboard/src/api/credits.api.ts apps/dashboard/src/pages/CreditsPage.tsx apps/dashboard/src/config/navigation.config.ts apps/dashboard/src/contexts/InstanceContext.tsx
git commit -m "feat(credits): Dashboard 积分充值页 + 三件套注册"
```

---

### Task 11: 环境守卫、部署配置与 smoke

**Files:**
- Modify: `apps/api/src/startup-check.ts`（新增 `REQUIRED_FILE_ENV` 文件类检查）
- Modify: `deploy/docker-compose.staging-api.yml`、`deploy/docker-compose.prod-api.yml`（secrets 卷）
- Create: `.github/workflows/scripts/smoke/payment-smoke.sh`
- Test: `apps/api/tests/startup-check-payment.test.ts`

**Interfaces:**
- Consumes: Task 8 的 env 名
- Produces: `checkRequiredFiles(env): string[]`（返回问题列表，空数组=通过）

- [ ] **Step 1: 写失败测试**

`apps/api/tests/startup-check-payment.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateKeyPairSync } from 'crypto';
import { checkRequiredFiles, checkPaymentEnvSanity } from '../src/startup-check';

const dir = mkdtempSync(join(tmpdir(), 'paycheck-'));

describe('checkRequiredFiles', () => {
  it('文件不存在 → 报出具体缺失项', () => {
    const problems = checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: join(dir, 'nope.pem') });
    expect(problems.join()).toMatch(/WX_PAY_PRIVATE_KEY_PATH/);
    expect(problems.join()).toMatch(/不存在/);
  });

  it('文件存在但不是合法私钥 → 报解析失败', () => {
    const p = join(dir, 'bad.pem');
    writeFileSync(p, 'not a key');
    const problems = checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: p });
    expect(problems.join()).toMatch(/无法解析/);
  });

  it('合法私钥 → 无问题', () => {
    const kp = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const p = join(dir, 'good.pem');
    writeFileSync(p, kp.privateKey);
    expect(checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: p })).toEqual([]);
  });

  it('未配置该 env → 跳过检查（provider 未启用是合法状态）', () => {
    expect(checkRequiredFiles({})).toEqual([]);
  });
});

describe('checkPaymentEnvSanity', () => {
  it('非 production 却配了生产商户号 → 拒绝启动', () => {
    const problems = checkPaymentEnvSanity({
      NODE_ENV: 'staging',
      WX_PAY_MCHID: '1900000109',
      WX_PAY_PROD_MCHID_DENYLIST: '1900000109,1900000110',
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join()).toMatch(/生产商户号/);
  });

  it('production 用生产商户号 → 正常', () => {
    expect(checkPaymentEnvSanity({
      NODE_ENV: 'production',
      WX_PAY_MCHID: '1900000109',
      WX_PAY_PROD_MCHID_DENYLIST: '1900000109',
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/startup-check-payment.test.ts`
Expected: FAIL — `checkRequiredFiles` / `checkPaymentEnvSanity` 未导出

- [ ] **Step 3: 写实现**

`apps/api/src/startup-check.ts` 追加导出（并在既有 `startupCheck()` 主流程里调用这两个函数，有问题时按既有方式红日志 + 退出）：

```typescript
import { existsSync, readFileSync } from 'fs';
import { createPrivateKey } from 'crypto';

/** 需要以「文件」形式提供的凭据（PEM 绝不进 env 变量） */
const REQUIRED_FILE_ENV = [
  'WX_PAY_PRIVATE_KEY_PATH',
  'WX_PAY_PLATFORM_CERT_PATH',
  'ALIPAY_PRIVATE_KEY_PATH',
  'ALIPAY_PUBLIC_KEY_PATH',
] as const;

/** 私钥类 env（需要试解析）与证书/公钥类（只需存在且非空）区分 */
const PRIVATE_KEY_ENV = new Set(['WX_PAY_PRIVATE_KEY_PATH', 'ALIPAY_PRIVATE_KEY_PATH']);

export function checkRequiredFiles(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  for (const key of REQUIRED_FILE_ENV) {
    const p = env[key];
    if (!p) continue; // 未配置 = 该 provider 未启用，合法
    if (!existsSync(p)) {
      problems.push(`${key} 指向的文件不存在: ${p}`);
      continue;
    }
    const content = readFileSync(p, 'utf8');
    if (content.trim().length === 0) {
      problems.push(`${key} 指向的文件为空: ${p}`);
      continue;
    }
    if (PRIVATE_KEY_ENV.has(key)) {
      try {
        createPrivateKey(content);
      } catch {
        problems.push(`${key} 无法解析为私钥: ${p}`);
      }
    }
  }
  return problems;
}

/** 防 staging 误用生产商户号 —— 真实资金风险，比普通 bug 重一个数量级 */
export function checkPaymentEnvSanity(env: NodeJS.ProcessEnv): string[] {
  const mchId = env.WX_PAY_MCHID;
  const denylist = (env.WX_PAY_PROD_MCHID_DENYLIST ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!mchId || denylist.length === 0) return [];
  if (env.NODE_ENV !== 'production' && denylist.includes(mchId)) {
    return [
      `非 production 环境(NODE_ENV=${env.NODE_ENV})配置了生产商户号 ${mchId}，拒绝启动`,
    ];
  }
  return [];
}
```

同时把这些 env 名登记进该文件既有的 `CRITICAL_ENV_USAGE`（指向 `src/services/payment/provider-registry.ts`），以满足 `env-registry.test.ts` 的强制登记。

`deploy/docker-compose.staging-api.yml` 与 `prod-api.yml` 的 api 服务下各加：

```yaml
    volumes:
      - /opt/zenithjoy/staging-api/secrets:/run/secrets/payment:ro   # prod 换成 prod-api
```

`.github/workflows/scripts/smoke/payment-smoke.sh`：

```bash
#!/usr/bin/env bash
# 支付回调公网可达性 smoke —— 从 GHA runner（公网出口）验证
# 域名/nginx 配置漂移会直接在 CI 红掉，而不是等真实回调丢了才发现
set -euo pipefail

BASE_URL="${PAYMENT_NOTIFY_BASE_URL:?PAYMENT_NOTIFY_BASE_URL 未设置}"
URL="${BASE_URL}/api/payment/callback/mock"

echo "[smoke] 探测回调端点: ${URL}"

# 不带签名头 POST：期望被验签拦下返回 403，
# 这同时证明了「端点可达」与「验签确实在生效」
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}" \
  -H 'Content-Type: application/json' --data '{}' --max-time 15)

if [[ "${code}" == "403" ]]; then
  echo "[smoke] PASS 回调端点可达且验签生效（403）"
  exit 0
fi

echo "[smoke] FAIL 期望 403，实际 ${code}"
echo "[smoke] 403 以外一律视为失败：404=路由没挂上，200=验签没生效（危险），5xx/000=不可达"
exit 1
```

```bash
chmod +x .github/workflows/scripts/smoke/payment-smoke.sh
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/startup-check-payment.test.ts && npx vitest run`
Expected: 新测试 PASS（6 passed），全量无回归

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/startup-check-payment.test.ts
git commit -m "test(credits): 私钥文件自检与 staging 误用生产商户号断言（先红）"
git add apps/api/src/startup-check.ts deploy/docker-compose.staging-api.yml deploy/docker-compose.prod-api.yml .github/workflows/scripts/smoke/payment-smoke.sh
git commit -m "feat(credits): 支付凭据启动自检 + secrets 卷挂载 + 回调可达 smoke"
```

---

### Task 12: 过期兜底调度与积压告警

Task 6 只提供了 `expireStaleOrders()` 函数，**没有任何地方调用它**。没有调度器，回调丢失的订单会永远躺在 `pending`，商家钱付了积分不到账。本 task 补上调度，并加 pending 积压告警。

**Files:**
- Create: `apps/api/src/services/payment/payment-monitor.ts`
- Modify: `apps/api/src/index.ts`（启动处挂载，与 `startAgentOfflineMonitor()` 并列）
- Test: `apps/api/tests/services/payment/payment-monitor.test.ts`

**Interfaces:**
- Consumes: Task 6 `expireStaleOrders()`
- Produces: `startPaymentMonitor(intervalMs?: number): void`、`stopPaymentMonitor(): void`、`scanPendingBacklog(): Promise<{ total: number; oldestAgeMs: number | null; alerted: boolean }>`

> 模式照 `src/services/agent-offline-monitor.ts:263-281`：模块级 timer、重复调用幂等、`unref()` 不阻止进程退出、异常只记日志不抛。

- [ ] **Step 1: 写失败测试**

`apps/api/tests/services/payment/payment-monitor.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/db/connection', () => ({
  default: { query: vi.fn() },
}));

const expireMock = vi.fn();
vi.mock('../../../src/services/payment/orders.service', () => ({
  expireStaleOrders: expireMock,
}));

const alertMock = vi.fn();
vi.mock('../../../src/services/feishu-alert', () => ({
  sendFeishuAlert: alertMock,
}), { virtual: true });

import {
  startPaymentMonitor,
  stopPaymentMonitor,
  scanPendingBacklog,
} from '../../../src/services/payment/payment-monitor';

const pool = (await import('../../../src/db/connection') as any).default;

beforeEach(() => {
  vi.useFakeTimers();
  pool.query.mockReset();
  expireMock.mockReset().mockResolvedValue({ scanned: 0, credited: 0, expired: 0 });
  alertMock.mockReset();
});

afterEach(() => {
  stopPaymentMonitor();
  vi.useRealTimers();
});

describe('startPaymentMonitor', () => {
  it('按间隔调用 expireStaleOrders', async () => {
    startPaymentMonitor(1000);
    expect(expireMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(2);
  });

  it('重复调用不会起第二个 timer', async () => {
    startPaymentMonitor(1000);
    startPaymentMonitor(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });

  it('expireStaleOrders 抛错不会让定时器停摆', async () => {
    expireMock.mockRejectedValueOnce(new Error('boom'));
    startPaymentMonitor(1000);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(expireMock).toHaveBeenCalledTimes(2);
  });

  it('stopPaymentMonitor 之后不再触发', async () => {
    startPaymentMonitor(1000);
    await vi.advanceTimersByTimeAsync(1000);
    stopPaymentMonitor();
    await vi.advanceTimersByTimeAsync(5000);
    expect(expireMock).toHaveBeenCalledTimes(1);
  });
});

describe('scanPendingBacklog', () => {
  it('积压笔数超阈值 → 告警', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '60', oldest_age_ms: '1000' }],
    });
    const r = await scanPendingBacklog();
    expect(r.total).toBe(60);
    expect(r.alerted).toBe(true);
  });

  it('最老一笔超 2 小时 → 告警（即使笔数不多）', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '2', oldest_age_ms: String(3 * 60 * 60 * 1000) }],
    });
    const r = await scanPendingBacklog();
    expect(r.alerted).toBe(true);
  });

  it('正常水位 → 不告警', async () => {
    pool.query.mockResolvedValue({
      rows: [{ total: '3', oldest_age_ms: '60000' }],
    });
    const r = await scanPendingBacklog();
    expect(r.alerted).toBe(false);
  });

  it('没有 pending 订单 → 不告警且 oldestAgeMs 为 null', async () => {
    pool.query.mockResolvedValue({ rows: [{ total: '0', oldest_age_ms: null }] });
    const r = await scanPendingBacklog();
    expect(r.total).toBe(0);
    expect(r.oldestAgeMs).toBeNull();
    expect(r.alerted).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/services/payment/payment-monitor.test.ts`
Expected: FAIL — 无法解析 `payment-monitor`

- [ ] **Step 3: 写实现**

`apps/api/src/services/payment/payment-monitor.ts`：

```typescript
/**
 * 支付兜底巡检 —— 定时扫过期 pending 订单（先查单再判过期），并监控积压水位。
 *
 * 没有这个调度器，回调一旦丢失订单会永远卡在 pending：商家钱付了、积分不到账。
 * 模式照 services/agent-offline-monitor.ts。
 */
import pool from '../../db/connection';
import { expireStaleOrders } from './orders.service';

/** 积压告警阈值（与设计文档告警表一致） */
const BACKLOG_COUNT_THRESHOLD = 50;
const BACKLOG_AGE_MS_THRESHOLD = 2 * 60 * 60 * 1000;

let monitorTimer: ReturnType<typeof setInterval> | null = null;

export interface BacklogResult {
  total: number;
  oldestAgeMs: number | null;
  alerted: boolean;
}

export async function scanPendingBacklog(): Promise<BacklogResult> {
  const r = await pool.query<{ total: string; oldest_age_ms: string | null }>(
    `SELECT count(*)::text AS total,
            (EXTRACT(EPOCH FROM (now() - min(created_at))) * 1000)::bigint::text AS oldest_age_ms
       FROM zenithjoy.payment_orders
      WHERE status = 'pending'`
  );
  const row = r.rows[0];
  const total = Number(row?.total ?? 0);
  const oldestAgeMs = row?.oldest_age_ms == null ? null : Number(row.oldest_age_ms);

  const alerted =
    total > BACKLOG_COUNT_THRESHOLD ||
    (oldestAgeMs !== null && oldestAgeMs > BACKLOG_AGE_MS_THRESHOLD);

  if (alerted) {
    console.error('[payment-monitor] pending 订单积压告警', {
      total,
      oldest_age_ms: oldestAgeMs,
      count_threshold: BACKLOG_COUNT_THRESHOLD,
      age_threshold_ms: BACKLOG_AGE_MS_THRESHOLD,
    });
  }

  return { total, oldestAgeMs, alerted };
}

async function tick(): Promise<void> {
  const r = await expireStaleOrders();
  if (r.scanned > 0) {
    console.info('[payment-monitor] 过期兜底完成', r);
  }
  await scanPendingBacklog();
}

export function startPaymentMonitor(
  intervalMs: number = Number(process.env.PAYMENT_SCAN_INTERVAL_MS ?? 5 * 60_000)
): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    void tick().catch((err) => {
      console.error('[payment-monitor] tick 异常:', (err as Error).message);
    });
  }, intervalMs);
  // 不阻止进程退出（同 agent-offline-monitor.ts 模式）
  (monitorTimer as { unref?: () => void }).unref?.();
}

export function stopPaymentMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
```

`apps/api/src/index.ts`：在 `startAgentOfflineMonitor();`（当前 line 87）之后加：

```typescript
    startPaymentMonitor();
```

并在顶部 import 区加：

```typescript
import { startPaymentMonitor } from './services/payment/payment-monitor';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/services/payment/payment-monitor.test.ts`
Expected: PASS（8 passed）

- [ ] **Step 5: 提交**

```bash
git add apps/api/tests/services/payment/payment-monitor.test.ts
git commit -m "test(credits): 过期兜底调度与积压告警断言（先红）"
git add apps/api/src/services/payment/payment-monitor.ts apps/api/src/index.ts
git commit -m "feat(credits): 支付兜底巡检调度 + pending 积压告警"
```

---

## 刀2 待办（需 Gate 0 通过后执行，不在本计划范围）

1. 同事核实微信支付商户号状态，取回 `mchid` / APIv3 密钥 / 证书序列号，存 1Password CS 并同步 `~/.credentials/wechat-pay.env`
2. 确认备案域名与备案主体；若现用 `autopilot.zenjoymedia.media`（香港 + Cloudflare）确实无法备案，按设计文档 Gate 0 的方案 A 起一台大陆最小服务器专跑回调端点
3. 私钥 PEM 以 root `scp` 放置到 hk-vps `/opt/zenithjoy/{staging,prod}-api/secrets/`（`chmod 700` 目录 / `600` 文件）
4. staging 用测试商户号真扫码付 1 分钱，`psql` 断言 `tenant_credits.balance` 真变 + `credit_transactions` 有对应 `order_id`
5. 每个环境接缝守卫做一次 proven-to-fire：删私钥 → 断言 `/health` 报红；把生产 mchid 塞进 staging → 断言拒绝启动
6. 生产 promote 走既有三重证据闸

## 本计划明确不做

退款自动扣回、每日对账 job、发票、自动续费代扣、套餐 tier 与积分联动、`ai_writing` 端点接入（功能本身不存在）。

