-- PR-C 积分基建（Credits Foundation） — 2026-04-29
--
-- 主理人决策（双轨产品 SaaS）：
--   - 每个 tenant 独立积分账户
--   - Free tier 注册送 100 积分（PR-B 实现 initial_grant）
--   - Paid tier 用积分 + 解锁本地 Agent
--   - 单价：AI 文案 5 / 对标分析 10（暂定，写代码常量便于调整）
--
-- 本 PR 只做基建（DB 表 + service + 中间件 + 充值/扣减 API），不接入业务端点。
-- 业务接入留给后续 PR。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ==================== 1. tenant_credits 余额表 ====================
-- 每个 tenant 一行（PRIMARY KEY = tenant_id），balance 必须 ≥ 0（CHECK 约束）

CREATE TABLE IF NOT EXISTS zenithjoy.tenant_credits (
  tenant_id        UUID PRIMARY KEY REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  balance          INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_recharged  INTEGER NOT NULL DEFAULT 0,
  total_consumed   INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE zenithjoy.tenant_credits IS '积分余额（每 tenant 一行）— PR-C Credits Foundation';

-- ==================== 2. credit_transactions 流水表 ====================
-- 每次充值/消耗写一行；正数 = 充值，负数 = 消耗
-- reason 枚举（不用 CHECK 约束，便于后续扩展）：
--   'initial_grant'        — PR-B 注册赠送
--   'recharge'             — 用户/admin 主动充值
--   'ai_writing'           — AI 文案消耗（-5）
--   'competitor_research'  — 对标分析消耗（-10）
--   'admin_adjust'         — 管理员手工调账

CREATE TABLE IF NOT EXISTS zenithjoy.credit_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant
  ON zenithjoy.credit_transactions(tenant_id, created_at DESC);

COMMENT ON TABLE zenithjoy.credit_transactions IS '积分流水（每次充值/消耗一行）— PR-C Credits Foundation';
