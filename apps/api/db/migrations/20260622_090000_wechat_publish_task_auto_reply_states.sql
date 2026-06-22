-- Line 04 无审批自动回复闭环 — 放开 wechat_publish_task 的两个 CHECK 约束。
--
-- 背景：原表（20260513_221814_create_wechat_publish_task.sql）的 A 路线护栏只容
--   status IN (draft,approved,rejected,sent,failed)
--   approval_source IN (feishu_user,feishu_api)
-- 自动回复闭环需要：
--   - approval_source 增 'system'（AI 无人审自动发，来源是系统而非飞书人审）
--   - status 增 'auto_sent'（自动发成功回执）/ 'pending_human'（名单外或超额转人工）
--     / 'send_failed'（读回失败/掉线回执，不重发）
-- 非法值仍须被拒（23514），所以是「放开白名单」而非「删约束」。
--
-- 原约束为匿名 CHECK，Postgres 自动命名 <table>_<column>_check；用 IF EXISTS 兜
-- 命名差异，重建时显式命名，幂等可重跑。

-- ① status：增 auto_sent / pending_human / send_failed
ALTER TABLE zenithjoy.wechat_publish_task
  DROP CONSTRAINT IF EXISTS wechat_publish_task_status_check;
ALTER TABLE zenithjoy.wechat_publish_task
  ADD CONSTRAINT wechat_publish_task_status_check
  CHECK (status IN (
    'draft', 'approved', 'rejected', 'sent', 'failed',
    'auto_sent', 'pending_human', 'send_failed'
  ));

-- ② approval_source：增 system（AI 自动发，无飞书人审）
ALTER TABLE zenithjoy.wechat_publish_task
  DROP CONSTRAINT IF EXISTS wechat_publish_task_approval_source_check;
ALTER TABLE zenithjoy.wechat_publish_task
  ADD CONSTRAINT wechat_publish_task_approval_source_check
  CHECK (approval_source IN ('feishu_user', 'feishu_api', 'system'));
