-- Current moment review/escalation producers use task_id/type/content_draft/tenant_id.
-- The 20260708 migration added those columns but left the original legacy columns
-- NOT NULL, so current inserts were swallowed by best-effort error handlers.
-- Preserve both supported row shapes; a new task must satisfy one complete shape.
BEGIN;
ALTER TABLE zenithjoy.wechat_publish_task
  ALTER COLUMN agent_id DROP NOT NULL,
  ALTER COLUMN task_type DROP NOT NULL,
  ALTER COLUMN content DROP NOT NULL,
  ALTER COLUMN approval_source DROP NOT NULL;
ALTER TABLE zenithjoy.wechat_publish_task
  DROP CONSTRAINT IF EXISTS wechat_publish_task_approval_source_check;
ALTER TABLE zenithjoy.wechat_publish_task
  ADD CONSTRAINT wechat_publish_task_approval_source_check
  CHECK (approval_source IN ('feishu_user', 'feishu_api', 'system', 'dashboard'));
ALTER TABLE zenithjoy.wechat_publish_task
  DROP CONSTRAINT IF EXISTS wechat_publish_task_supported_shape;
ALTER TABLE zenithjoy.wechat_publish_task
  ADD CONSTRAINT wechat_publish_task_supported_shape CHECK (
    (agent_id IS NOT NULL AND task_type IS NOT NULL AND content IS NOT NULL AND approval_source IS NOT NULL)
    OR
    (tenant_id IS NOT NULL AND task_id IS NOT NULL AND task_id <> ''
      AND platform = 'wechat_personal' AND platform IS NOT NULL
      AND type IN ('moment', 'private_chat') AND type IS NOT NULL
      AND content_draft IS NOT NULL AND approval_status IS NOT NULL
      AND approval_status IN ('pending_review', 'approved', 'rejected'))
  ) NOT VALID;
-- NOT VALID preserves historical rows while enforcing this contract for all new writes.
COMMIT;
