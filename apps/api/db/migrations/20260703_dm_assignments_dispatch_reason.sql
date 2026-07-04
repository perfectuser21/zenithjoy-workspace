-- apps/api/db/migrations/20260703_dm_assignments_dispatch_reason.sql
-- Line02 Sprint: buildAssignments 真调度升级
-- 新增 dispatch_reason 列 + pending_dispatch 到 check constraint
--
-- 幂等：ADD COLUMN IF NOT EXISTS + DROP/ADD constraint

-- 1. 新增 dispatch_reason 列（记录选号原因：'least_load' 等）
ALTER TABLE zenithjoy.dm_assignments
  ADD COLUMN IF NOT EXISTS dispatch_reason text;

COMMENT ON COLUMN zenithjoy.dm_assignments.dispatch_reason IS
  'Line02 真调度选号原因：least_load（在线 + 当天任务量最少）';

-- 2. 更新 status check constraint，加入 pending_dispatch
-- 全离线时写入该状态，等待下一个派发周期在线后补派
DO $$
BEGIN
  ALTER TABLE zenithjoy.dm_assignments
    DROP CONSTRAINT IF EXISTS chk_dm_assign_status;
  ALTER TABLE zenithjoy.dm_assignments
    ADD CONSTRAINT chk_dm_assign_status
    CHECK (status IN ('queued', 'dispatched', 'sent', 'limited', 'failed', 'pending_dispatch'));
END;
$$;
