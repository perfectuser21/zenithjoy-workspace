-- Line04 微信智能客服 — 飞书「客户列表」表 + 飞书→本地单向同步（S5 第一刀）
--
-- 背景：Line04 客服无专属飞书表（Issue 4fc5afb6）、飞书→本地同步未实现（Issue e57c434a）。
-- 本迁移建两件东西：
--   1) zenithjoy.tenant_feishu_bindings 加 table_id_customer_list 列 —— 缓存该租户飞书
--      「客户列表」Bitable 表 id（provision 幂等：已建过直接复用，不重复建）。
--   2) zenithjoy.feishu_customer_list 镜像表 —— 飞书→本地单向同步的只读镜像，管理员在飞书
--      维护客户名单，sync job 拉下来 upsert 进这张表。
--
-- 决策（PrepPRD sprints/06240002-line04-feishu-customer-list）：
--   · 只建「客户列表」1 张表（互动/聊天/日报二期）。
--   · 独立镜像表，**不覆盖** S2 管的 wechat_cs_account_config.whitelist（避免和权限白名单打架；
--     "飞书当名单唯一 SSOT" 大决策等加厚再定）。
--   · 唯一键 (tenant_id, feishu_record_id) 保证同步幂等（按飞书行 id upsert，不翻倍）。
--   · 软删：飞书删行 → 镜像 is_deleted=true，不物理删（不误伤别的行）。
--
-- schema 前缀：apps/api/db/migrations 下所有表统一在 zenithjoy. schema（run-migration.ts
-- CREATE SCHEMA IF NOT EXISTS zenithjoy）。

-- 1) binding 表加客户列表 table_id 缓存列（幂等 ALTER）
ALTER TABLE zenithjoy.tenant_feishu_bindings
  ADD COLUMN IF NOT EXISTS table_id_customer_list text;

COMMENT ON COLUMN zenithjoy.tenant_feishu_bindings.table_id_customer_list IS
  'Line04 飞书「客户列表」Bitable 表 id（provision 幂等缓存；空=未建）';

-- 2) 飞书→本地单向同步镜像表
CREATE TABLE IF NOT EXISTS zenithjoy.feishu_customer_list (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  feishu_record_id text NOT NULL,                  -- 飞书 Bitable 行 record_id（同步幂等 key）
  customer_name    text NOT NULL DEFAULT '',       -- 客户名
  customer_wechat  text NOT NULL DEFAULT '',       -- 微信号
  note             text,                            -- 备注（可空）
  is_deleted       boolean NOT NULL DEFAULT false,  -- 软删：飞书删行 → true（不物理删）
  synced_at        timestamptz NOT NULL DEFAULT now(), -- 最近一次同步时间（数据行断言带时间窗防假绿）
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fcl_tenant_record UNIQUE (tenant_id, feishu_record_id)
);

CREATE INDEX IF NOT EXISTS idx_fcl_tenant
  ON zenithjoy.feishu_customer_list (tenant_id) WHERE is_deleted = false;

COMMENT ON TABLE zenithjoy.feishu_customer_list IS
  'Line04 飞书「客户列表」飞书→本地单向同步只读镜像；唯一键 (tenant_id, feishu_record_id) 保幂等；'
  '不覆盖 wechat_cs_account_config.whitelist（独立镜像，避免和权限白名单打架）';
