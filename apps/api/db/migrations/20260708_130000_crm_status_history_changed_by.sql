-- Migration: 给 crm_customer_status_history 加 changed_by 列
-- 幂等：ADD COLUMN IF NOT EXISTS
-- CHECK 约束：只允许 'ai_inferred' 或 'manual'
-- 历史行回填：SET changed_by='manual'

ALTER TABLE zenithjoy.crm_customer_status_history
  ADD COLUMN IF NOT EXISTS changed_by TEXT DEFAULT 'manual'
  CHECK (changed_by IN ('ai_inferred', 'manual'));

-- 回填历史行（changed_by 为 NULL 的行，因为 DEFAULT 只对新行生效）
UPDATE zenithjoy.crm_customer_status_history
  SET changed_by = 'manual'
  WHERE changed_by IS NULL;
