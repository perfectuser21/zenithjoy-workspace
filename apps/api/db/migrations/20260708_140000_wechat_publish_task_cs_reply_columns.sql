-- Migration: 给 wechat_publish_task 补全 wechat-cs-reply 写入所需列
--
-- 背景：原建表（20260513）用了旧字段名（agent_id/task_type/content/target_friend_alias/status）；
-- wechat-draft.ts generateChatDraft / generateMomentDraft 使用了新字段名风格的 INSERT：
--   task_id / platform / type / target_user / content_draft / approval_status
-- 这些列在 CI DB 里不存在，导致 escalate INSERT 失败（warn 吞掉不阻塞对话，但 smoke S-1 无法验收）。
--
-- 修复：ADD COLUMN IF NOT EXISTS 幂等补全缺失列，不破坏旧列。
-- approval_source / reason / tenant_id 已在前序 migration 加过（20260622 / 20260708_130001），此处不重复。

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS task_id TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS platform TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS type TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS target_user TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS content_draft TEXT;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS approval_status TEXT;

COMMENT ON COLUMN zenithjoy.wechat_publish_task.task_id IS
  'wechat-cs-reply 接入：任务唯一 ID（UUID 字符串，业务主键，区别于行 id）';
COMMENT ON COLUMN zenithjoy.wechat_publish_task.platform IS
  'wechat-cs-reply 接入：发布平台，如 wechat_personal';
COMMENT ON COLUMN zenithjoy.wechat_publish_task.type IS
  'wechat-cs-reply 接入：任务类型，如 private_chat / moment';
COMMENT ON COLUMN zenithjoy.wechat_publish_task.target_user IS
  'wechat-cs-reply 接入：目标用户标识（微信好友名/ID）';
COMMENT ON COLUMN zenithjoy.wechat_publish_task.content_draft IS
  'wechat-cs-reply 接入：AI 草稿内容（待发或已发文案）';
COMMENT ON COLUMN zenithjoy.wechat_publish_task.approval_status IS
  'wechat-cs-reply 接入：审批状态，如 pending_review / approved';
