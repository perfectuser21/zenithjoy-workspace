-- apps/api/db/migrations/20260428_100000_create_tenants.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  license_key       text NOT NULL UNIQUE,
  plan              text NOT NULL DEFAULT 'free',
  feishu_app_id     text,
  feishu_app_secret text,
  feishu_bitable    text,
  feishu_table_crm  text,
  feishu_table_log  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zenithjoy.tenants IS '多租户 — 每个客户一行，license_key 是 Agent 连接凭证';
