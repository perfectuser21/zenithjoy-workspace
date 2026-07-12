-- apps/api/db/migrations/20260712_dm_assignments_cancelled_status.sql
-- Line02 内容判定门槛 FR-8：outreach_eligible 降级取消 dm_assignments
--
-- acquisition-dispatch.ts rescoreLead() 在 outreach_eligible 变 false 时会
-- UPDATE dm_assignments SET status='cancelled'，但 chk_dm_assign_status 约束
-- （20260626_214500_acquisition_dispatch.sql / 20260703_dm_assignments_dispatch_reason.sql
-- 两次迁移都没加 'cancelled'）只允许 queued/dispatched/sent/limited/failed/pending_dispatch，
-- 真机验收复现：该 UPDATE 直接违反 CHECK 约束报错。
--
-- 幂等：DROP/ADD constraint

DO $$
BEGIN
  ALTER TABLE zenithjoy.dm_assignments
    DROP CONSTRAINT IF EXISTS chk_dm_assign_status;
  ALTER TABLE zenithjoy.dm_assignments
    ADD CONSTRAINT chk_dm_assign_status
    CHECK (status IN ('queued', 'dispatched', 'sent', 'limited', 'failed', 'pending_dispatch', 'cancelled'));
END;
$$;
