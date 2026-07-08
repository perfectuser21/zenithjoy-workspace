-- Migration: crm_customer_status_history
-- Sprint: 07081012-crm-status-history
-- 幂等 DDL：可重复执行

-- 1. 建历史表
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   uuid      NOT NULL,
  cs_wechat_id text     NOT NULL,
  contact     text      NOT NULL,
  old_status  text      CHECK (old_status IN ('A1','A2','A3','A4','A5')),  -- NULL = 新客户首次
  new_status  text      NOT NULL CHECK (new_status IN ('A1','A2','A3','A4','A5')),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. 索引（幂等）
CREATE INDEX IF NOT EXISTS idx_crm_customer_status_history_tenant_wechat
  ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id);

CREATE INDEX IF NOT EXISTS idx_crm_customer_status_history_contact
  ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact);

CREATE INDEX IF NOT EXISTS idx_crm_customer_status_history_changed_at
  ON zenithjoy.crm_customer_status_history (changed_at DESC);

-- 3. 回填现有 crm_customers 行（old_status=NULL 表示首次记录，幂等：NOT EXISTS 子查询）
INSERT INTO zenithjoy.crm_customer_status_history
  (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
SELECT
  c.tenant_id,
  c.cs_wechat_id,
  c.contact,
  NULL AS old_status,
  c.status AS new_status,
  COALESCE(c.created_at, now()) AS changed_at
FROM zenithjoy.crm_customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM zenithjoy.crm_customer_status_history h
  WHERE h.tenant_id    = c.tenant_id
    AND h.cs_wechat_id = c.cs_wechat_id
    AND h.contact      = c.contact
    AND h.old_status IS NULL
);
