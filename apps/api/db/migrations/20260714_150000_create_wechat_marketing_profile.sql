-- apps/api/db/migrations/20260714_150000_create_wechat_marketing_profile.sql
-- Path4 朋友圈草稿营销画像本地化——替代原飞书"营销画像"Bitable 表（决策 19e6480c）
--
-- generateMomentDraft 原来 SELECT 飞书 Bitable 拿 行业/受众/钩子文案 三字段，
-- 本迁移建本地表承接同样三字段，供 wechat-draft.ts 直接 SQL 读写。

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_marketing_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer TEXT NOT NULL,
  industry TEXT,
  audience TEXT,
  hook TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wechat_marketing_profile_tenant_customer
  ON zenithjoy.wechat_marketing_profile (tenant_id, customer);
