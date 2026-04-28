-- Tenant 统一隔离层 — 取代 Sprint B 的 owner_id（飞书 ID）方案
--
-- 决策（与主理人对齐）：
--   "同公司多人共享作品" → 主隔离维度是 tenant（公司），不是 owner（个人）
--   未来 RBAC（自媒体看不到财务）独立加层，不影响 tenant 隔离
--
-- 改造：
--   1. licenses 加 tenant_id（连接 license 与 tenant）+ 用 license_key 反向回填
--   2. 新建 tenant_members（多对一：飞书 ID → tenant_id），从 licenses.customer_id 回填
--   3. works 加 tenant_id（取代 owner_id 作为隔离 key）+ 从 owner_id → license → tenant 回填
--   4. owner_id 保留为审计字段（"谁创建的"），不再用于隔离
--
-- 后续业务表（topics / pipeline_runs / fields 等）复制本 migration 的 works 段即可。

BEGIN;

-- ==================== 1. licenses 加 tenant_id ====================

ALTER TABLE zenithjoy.licenses
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- 反向回填：用 license_key 关联 tenants（tenants 表已存在 license_key UNIQUE 列）
UPDATE zenithjoy.licenses l
   SET tenant_id = t.id
  FROM zenithjoy.tenants t
 WHERE l.license_key = t.license_key
   AND l.tenant_id IS NULL;

-- FK：删 license 时不删 tenant；删 tenant 时把 license.tenant_id 置 NULL（孤儿 license）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licenses_tenant_id_fkey'
  ) THEN
    ALTER TABLE zenithjoy.licenses
      ADD CONSTRAINT licenses_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES zenithjoy.tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_licenses_tenant ON zenithjoy.licenses(tenant_id);

-- ==================== 2. tenant_members（多对一：用户 → tenant） ====================

CREATE TABLE IF NOT EXISTS zenithjoy.tenant_members (
  tenant_id       UUID NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  feishu_user_id  TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'（v1 全部 member，未来 RBAC 用）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feishu_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON zenithjoy.tenant_members(feishu_user_id);

-- 回填：每条已有的 license.customer_id（如果非空且匹配 tenant）→ 加为 owner role
INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
SELECT l.tenant_id, l.customer_id, 'owner'
  FROM zenithjoy.licenses l
 WHERE l.tenant_id IS NOT NULL
   AND l.customer_id IS NOT NULL
   AND l.customer_id <> ''
ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING;

-- ==================== 3. works 加 tenant_id ====================

ALTER TABLE zenithjoy.works
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'works_tenant_id_fkey'
  ) THEN
    ALTER TABLE zenithjoy.works
      ADD CONSTRAINT works_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES zenithjoy.tenants(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_works_tenant ON zenithjoy.works(tenant_id);

-- 回填：works.owner_id（飞书 ID）→ tenant_members.tenant_id（首个匹配）→ works.tenant_id
UPDATE zenithjoy.works w
   SET tenant_id = tm.tenant_id
  FROM zenithjoy.tenant_members tm
 WHERE w.owner_id = tm.feishu_user_id
   AND w.tenant_id IS NULL;

-- 注：owner_id 列保留作审计（"创建者飞书 ID"），但不再用于隔离过滤

COMMIT;
