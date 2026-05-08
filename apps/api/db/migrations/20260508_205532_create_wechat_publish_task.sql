-- ws1 (Path 4 Sprint 1)
-- 微信个人号发布任务表 — A 路线护栏：approval_source 仅允许 feishu_user / feishu_api
-- 禁 system / auto，强制人工/飞书复核闭环。

CREATE TABLE IF NOT EXISTS wechat_publish_task (
  task_id            UUID PRIMARY KEY,
  platform           TEXT NOT NULL DEFAULT 'wechat_personal'
                      CHECK (platform IN ('wechat_personal')),
  type               TEXT NOT NULL
                      CHECK (type IN ('moment', 'chat')),
  target_user        TEXT,                    -- type=chat 时非空（应用层校验）
  content_draft      TEXT NOT NULL,
  approval_status    TEXT NOT NULL DEFAULT 'pending_review'
                      CHECK (approval_status IN (
                        'pending_review','approved','rejected',
                        'published','failed','rate_limited'
                      )),
  -- A 路线护栏：approval_source CHECK (feishu_user, feishu_api) — 禁 system/auto
  approval_source    TEXT CHECK (approval_source IN ('feishu_user', 'feishu_api')),
  rate_limit_status  TEXT,
  next_allowed_at    TIMESTAMPTZ,
  receipt_status     TEXT,
  receipt_error      TEXT,
  feishu_record_id   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 二元约束：approval_status='approved' 时 approval_source 必须 IN (feishu_user, feishu_api)
  CONSTRAINT wechat_publish_task_approved_source_chk
    CHECK (
      (approval_status != 'approved')
      OR (approval_source IN ('feishu_user', 'feishu_api'))
    )
);

CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_status
  ON wechat_publish_task (approval_status);
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_feishu_record
  ON wechat_publish_task (feishu_record_id)
  WHERE feishu_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_created
  ON wechat_publish_task (created_at);

COMMENT ON TABLE wechat_publish_task IS 'Path 4 微信个人号发布任务（朋友圈 + 私聊），approval_source 仅允许飞书人工/API 审批，禁 system/auto';
COMMENT ON COLUMN wechat_publish_task.approval_source IS 'A 路线护栏：approved 状态必须有 feishu_user 或 feishu_api 来源，禁止 system/auto 自动放行';
