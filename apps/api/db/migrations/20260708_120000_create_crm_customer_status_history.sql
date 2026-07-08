-- Migration: crm_customer_status_history
-- Sprint: 07081012-crm-status-history
-- 客户状态流转历史追踪表：记录每次 status 变化（old→new）
-- 幂等：IF NOT EXISTS + ON CONFLICT DO NOTHING

-- 1. 建表
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT        NOT NULL,
  customer_id UUID        NOT NULL REFERENCES zenithjoy.crm_customers(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 索引（按租户+客户+时间倒序，支持时间线查询）
CREATE INDEX IF NOT EXISTS idx_crm_status_history_customer
  ON zenithjoy.crm_customer_status_history(tenant_id, customer_id, changed_at DESC);

-- 3. 回填：把现有 crm_customers 的 status 各写一条历史行（old_status=NULL，表示"初始状态"）
-- ON CONFLICT DO NOTHING 保证幂等（重跑不重复插入）
-- 注意：crm_customers 没有 unique(id) 的 conflict target，所以这里用子查询判断是否已有回填行
INSERT INTO zenithjoy.crm_customer_status_history (tenant_id, customer_id, old_status, new_status, changed_at)
SELECT
  c.tenant_id,
  c.id,
  NULL,
  c.status,
  COALESCE(c.created_at, NOW())
FROM zenithjoy.crm_customers c
WHERE c.status IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM zenithjoy.crm_customer_status_history h
    WHERE h.customer_id = c.id AND h.old_status IS NULL
  );
