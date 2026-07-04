-- Migration: acquisition_leads 加 latest_reply / latest_reply_at / assignee / comment_replied_at
-- + 新建 acquisition_orphan_replies 孤儿回复日志表
-- 使用 ADD COLUMN IF NOT EXISTS DEFAULT NULL（无 table rewrite，锁瞬间释放）

ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS latest_reply        TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS latest_reply_at     TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assignee            TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS comment_replied_at  TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_orphan_replies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id            TEXT NOT NULL,
  commenter_nickname  TEXT NOT NULL,
  reply_text          TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id           UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acquisition_orphan_replies_tenant_captured
  ON zenithjoy.acquisition_orphan_replies (tenant_id, captured_at DESC);
