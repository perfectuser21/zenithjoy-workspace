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
