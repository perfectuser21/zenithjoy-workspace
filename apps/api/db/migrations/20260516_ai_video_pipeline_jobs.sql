-- AI 视频本地流水线 job 状态追踪表
CREATE TABLE IF NOT EXISTS zenithjoy.ai_video_pipeline_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status     TEXT NOT NULL DEFAULT 'pending',
  progress   INT  NOT NULL DEFAULT 0,
  src_video  TEXT,
  src_logo   TEXT,
  topic      TEXT,
  result_url TEXT,
  error_msg  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status
  ON zenithjoy.ai_video_pipeline_jobs(status);
