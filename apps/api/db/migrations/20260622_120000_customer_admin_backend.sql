-- Line 10 客户管理后台 — 子账号 / 客服-PC 绑定 / 轻量审计
--
-- 表：
--   zenithjoy.tenant_sub_accounts  — 一公司多子账号（含 role + 软删），配额随 license tier
--   zenithjoy.service_agents       — 客服账号 ↔ PC 绑定（1:1 双唯一 partial unique + 软删）
--   zenithjoy.customer_admin_audit — 轻量审计（who / when / what）：建/改/删账号·绑定各记一行
--
-- 幂等：全部 CREATE TABLE IF NOT EXISTS / CREATE [UNIQUE] INDEX IF NOT EXISTS，可重入。
-- 租户隔离：tenant_sub_accounts / service_agents / customer_admin_audit 均带 tenant_id。

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==================== 1. tenant_sub_accounts（子账号） ====================
CREATE TABLE IF NOT EXISTS zenithjoy.tenant_sub_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  role          text NOT NULL CHECK (role IN ('admin','operator','service_agent')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- 同租户内邮箱唯一（仅对未软删行生效 → 软删后可复用同邮箱）
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_accounts_tenant_email_active
  ON zenithjoy.tenant_sub_accounts(tenant_id, lower(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sub_accounts_tenant
  ON zenithjoy.tenant_sub_accounts(tenant_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE zenithjoy.tenant_sub_accounts IS '租户子账号 — 一公司多账号，role 区分 admin/operator/service_agent，软删走 deleted_at';

-- ==================== 2. service_agents（客服-PC 绑定，1:1 双唯一） ====================
CREATE TABLE IF NOT EXISTS zenithjoy.service_agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES zenithjoy.tenant_sub_accounts(id) ON DELETE CASCADE,
  machine_id  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- 双唯一（partial，仅未软删行）：1 客服只能绑 1 PC，1 PC 只能被 1 客服绑
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agents_account_active
  ON zenithjoy.service_agents(account_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agents_machine_active
  ON zenithjoy.service_agents(machine_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_service_agents_tenant
  ON zenithjoy.service_agents(tenant_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE zenithjoy.service_agents IS '客服账号↔PC 绑定（account_id / machine_id 双 partial unique = 1:1），软删走 deleted_at';

-- ==================== 3. customer_admin_audit（轻量审计 who/when/what） ====================
CREATE TABLE IF NOT EXISTS zenithjoy.customer_admin_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  actor        text NOT NULL,        -- who：操作者（feishu user id / email / internal）
  action       text NOT NULL,        -- what：动作（create_account / delete_account / bind_device / ...）
  target_type  text,                 -- 受影响实体类型（sub_account / binding / tenant）
  target_id    text,                 -- 受影响实体 id
  created_at   timestamptz NOT NULL DEFAULT now()  -- when
);

CREATE INDEX IF NOT EXISTS idx_customer_admin_audit_tenant_time
  ON zenithjoy.customer_admin_audit(tenant_id, created_at DESC);

COMMENT ON TABLE zenithjoy.customer_admin_audit IS '客户管理后台轻量审计 — 建/改/删账号·绑定各记一行 actor(who)/action(what)/created_at(when)';
