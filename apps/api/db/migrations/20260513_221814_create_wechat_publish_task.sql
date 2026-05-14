-- Path 4 Sprint 1 WS1 — 个微发布任务表
--
-- approval_source CHECK 约束 enforce A 路线护栏:
--   AI 一律不直接发, 只能 feishu_user (人审) 或 feishu_api (飞书 webhook 自动审).
--   任何 INSERT 'system'/'ai'/etc → 23514 violation.

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_publish_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('moments', 'private_chat')),
  content TEXT NOT NULL,
  target_friend_alias TEXT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'sent', 'failed')),
  approval_source TEXT NOT NULL
    CHECK (approval_source IN ('feishu_user', 'feishu_api')),
  approved_by TEXT NULL,
  approved_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_agent_id ON zenithjoy.wechat_publish_task(agent_id);
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_status ON zenithjoy.wechat_publish_task(status);
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_scheduled_at ON zenithjoy.wechat_publish_task(scheduled_at);
