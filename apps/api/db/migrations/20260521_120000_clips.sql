-- apps/api/db/migrations/20260521_120000_clips.sql
CREATE TABLE IF NOT EXISTS zenithjoy.clips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  url           TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('douyin','xiaohongshu')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  title         TEXT,
  transcript    TEXT,
  images        JSONB DEFAULT '[]',
  author        TEXT,
  author_id     TEXT,
  like_count    INTEGER,
  comment_count INTEGER,
  share_count   INTEGER,
  cover_url     TEXT,
  video_url     TEXT,
  output_url    TEXT,
  output_type   TEXT CHECK (output_type IN ('notion','feishu')),
  output_status TEXT DEFAULT 'pending'
                  CHECK (output_status IN ('pending','pushed','failed','skipped')),
  raw_response  JSONB,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  error_msg     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_clips_user_status   ON zenithjoy.clips(user_id, status);
CREATE INDEX IF NOT EXISTS idx_clips_user_platform ON zenithjoy.clips(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_clips_created       ON zenithjoy.clips(created_at DESC);

CREATE TABLE IF NOT EXISTS zenithjoy.user_clip_settings (
  user_id             TEXT PRIMARY KEY,
  default_output_url  TEXT,
  default_output_type TEXT CHECK (default_output_type IN ('notion','feishu')),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
