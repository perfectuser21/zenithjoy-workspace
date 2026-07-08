-- Migration: 给 wechat_publish_task 加 reason 和 tenant_id 列
-- reason: 记录任务原因（如 cs_escalate）
-- tenant_id: 多租户隔离
-- 幂等：ADD COLUMN IF NOT EXISTS

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS tenant_id UUID;

COMMENT ON COLUMN zenithjoy.wechat_publish_task.reason IS
  'wechat-cs-reply 接入：记录任务来源原因，如 cs_escalate（客服转人工）';

COMMENT ON COLUMN zenithjoy.wechat_publish_task.tenant_id IS
  'wechat-cs-reply 接入：多租户隔离，关联 zenithjoy.tenants.id';
