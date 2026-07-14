-- Path4 去飞书：营销画像表迁移到本地 DB
-- 替换 Feishu "营销画像" Bitable 表（FEISHU_PROFILE_TABLE_ID）
-- decision 19e6480c: 删 wechat-draft generateMomentDraft 飞书依赖，改本地

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_marketing_profile (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  customer   text        NOT NULL,
  industry   text        NOT NULL DEFAULT '',
  audience   text        NOT NULL DEFAULT '',
  hook       text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_wmp_tenant_customer UNIQUE (tenant_id, customer)
);

CREATE INDEX IF NOT EXISTS idx_wmp_tenant
  ON zenithjoy.wechat_marketing_profile (tenant_id);

COMMENT ON TABLE zenithjoy.wechat_marketing_profile IS
  'Path4 营销画像本地表（替换飞书 FEISHU_PROFILE_TABLE_ID；decision 19e6480c）';
