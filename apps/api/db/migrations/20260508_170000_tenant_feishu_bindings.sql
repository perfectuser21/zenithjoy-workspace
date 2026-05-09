-- apps/api/db/migrations/20260508_170000_tenant_feishu_bindings.sql
-- Path 2 Sprint A WS1: 多租户飞书 OAuth 绑定表
-- 每个 tenant 一行：tenant_access_token + 自动建好的 Bitable 文档 + 3 张表 ID
-- R2 用：needs_retry / provision_error 记录 provisionBitable 中途失败状态

CREATE TABLE IF NOT EXISTS zenithjoy.tenant_feishu_bindings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  tenant_access_token      text,
  expires_at               timestamptz,
  app_token                text,
  table_id_lead_profile    text,
  table_id_target_videos   text,
  table_id_leads           text,
  bound_at                 timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at        timestamptz,
  needs_retry              boolean NOT NULL DEFAULT false,
  provision_error          text,
  CONSTRAINT uq_tfb_tenant UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_tfb_tenant ON zenithjoy.tenant_feishu_bindings(tenant_id);

COMMENT ON TABLE zenithjoy.tenant_feishu_bindings IS
  'Path 2 多租户飞书绑定 — tenant_access_token 自动续 + Bitable 自动建表 4 个 ID 缓存 + R2 needs_retry';
