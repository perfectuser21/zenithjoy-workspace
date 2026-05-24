-- apps/api/db/migrations/20260524_100000_acquisition_tables.sql
-- 采集关键词任务表（存储关键词、扩展词列表及任务状态）
CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_keyword_tasks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword           TEXT        NOT NULL,
  expanded_keywords JSONB       NOT NULL DEFAULT '[]',
  status            TEXT        NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acq_kw_tasks_status ON zenithjoy.acquisition_keyword_tasks(status);
CREATE INDEX IF NOT EXISTS idx_acq_kw_tasks_created ON zenithjoy.acquisition_keyword_tasks(created_at DESC);

-- 采集视频表（记录每个关键词任务找到的视频及评论任务状态）
CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_videos (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_task_id     UUID        NOT NULL REFERENCES zenithjoy.acquisition_keyword_tasks(id) ON DELETE CASCADE,
  keyword             TEXT        NOT NULL,
  video_url           TEXT        NOT NULL,
  comment_task_status TEXT        NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acq_videos_task_id ON zenithjoy.acquisition_videos(keyword_task_id);
CREATE INDEX IF NOT EXISTS idx_acq_videos_status  ON zenithjoy.acquisition_videos(comment_task_status);
CREATE INDEX IF NOT EXISTS idx_acq_videos_created ON zenithjoy.acquisition_videos(created_at DESC);
