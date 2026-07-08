-- Migration: crm_customer_status_history
-- Sprint: 07081012-crm-status-history
-- 建 crm_customer_status_history 表 + 索引 + 回填（幂等）

-- 建表
CREATE TABLE IF NOT EXISTS zenithjoy.crm_customer_status_history (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  cs_wechat_id TEXT       NOT NULL,
  contact     TEXT        NOT NULL,
  old_status  TEXT        NULL,
  new_status  TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引（幂等：IF NOT EXISTS 不支持索引，用 DO $$ 块检测）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'zenithjoy'
      AND tablename  = 'crm_customer_status_history'
      AND indexname  = 'idx_crm_customer_status_history_lookup'
  ) THEN
    CREATE INDEX idx_crm_customer_status_history_lookup
      ON zenithjoy.crm_customer_status_history (tenant_id, cs_wechat_id, contact);
  END IF;
END
$$;

-- 唯一约束（支持 ON CONFLICT DO NOTHING 回填幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_crm_csh_initial_backfill'
      AND conrelid = 'zenithjoy.crm_customer_status_history'::regclass
  ) THEN
    ALTER TABLE zenithjoy.crm_customer_status_history
      ADD CONSTRAINT uq_crm_csh_initial_backfill
      UNIQUE (tenant_id, cs_wechat_id, contact, new_status)
      DEFERRABLE INITIALLY DEFERRED;
    -- 注：此唯一约束仅为支持回填幂等；运行时写入无需依赖此约束
  END IF;
END
$$;

-- 回填：将 crm_customers 中已有 status 的记录写入历史表（old_status=NULL = 初始状态）
INSERT INTO zenithjoy.crm_customer_status_history
  (tenant_id, cs_wechat_id, contact, old_status, new_status, changed_at)
SELECT
  tenant_id,
  cs_wechat_id,
  contact,
  NULL AS old_status,
  status AS new_status,
  COALESCE(updated_at, now()) AS changed_at
FROM zenithjoy.crm_customers
WHERE status IS NOT NULL
ON CONFLICT (tenant_id, cs_wechat_id, contact, new_status) DO NOTHING;
