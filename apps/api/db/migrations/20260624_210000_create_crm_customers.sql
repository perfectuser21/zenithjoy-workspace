-- Line04 中台 AI-native CRM·客户列表页 — crm_customers 客户名册手动/状态表
--
-- 名册三源合并：cs_memory_messages distinct 已聊过的人 ∪ 本表 source='manual' 手动加的人 ∪
-- wechat_cs_account_config.whitelist 接管中的人。本表只承载「手动入册」与「状态 A1-A5 持久化」两件事；
-- 已聊过的人由 cs_memory_messages 提供，接管态由 whitelist 提供，均不进本表。
--
-- 身份 key 第一刀用微信昵称 contact（与 whitelist / cs_config_gate.should_reply 的 sender_name 同字面）。
-- 唯一键 (tenant_id, cs_wechat_id, contact) 保证 upsert 幂等：同客户重复入册 / 改状态 → 覆盖同一行。
-- status CHECK 钉死 A1-A5；source CHECK 区分 message/manual。租户隔离靠 tenant_id（读写都带 WHERE）。
-- 幂等：CREATE TABLE / INDEX IF NOT EXISTS（E2E smoke 可重入）。

CREATE TABLE IF NOT EXISTS zenithjoy.crm_customers (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  cs_wechat_id text NOT NULL,                          -- 所属客服机微信号 = wechat_cs_account_config 主 key
  contact      text NOT NULL,                          -- 客户昵称（第一刀身份 key，与 whitelist / should_reply 同字面）
  wechat_id    text,                                   -- 客户微信号（手填可空）
  status       text NOT NULL DEFAULT 'A1' CHECK (status IN ('A1','A2','A3','A4','A5')),
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('message','manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cs_wechat_id, contact)
);

CREATE INDEX IF NOT EXISTS idx_crm_customers_tenant_cs
  ON zenithjoy.crm_customers (tenant_id, cs_wechat_id);

COMMENT ON TABLE zenithjoy.crm_customers IS
  'Line04 中台 CRM 客户名册（手动入册 + 状态 A1-A5 持久化）；与 cs_memory_messages / whitelist 三源合并成客户列表';
