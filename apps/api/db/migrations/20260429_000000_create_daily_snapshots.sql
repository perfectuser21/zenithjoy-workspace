BEGIN;

CREATE TABLE IF NOT EXISTS zenithjoy.daily_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     VARCHAR(20)  NOT NULL,
  content_id   VARCHAR(200) NOT NULL,
  scraped_date DATE         NOT NULL,
  scraped_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  title        TEXT,
  views        INTEGER      NOT NULL DEFAULT 0,
  likes        INTEGER      NOT NULL DEFAULT 0,
  comments     INTEGER      NOT NULL DEFAULT 0,
  shares       INTEGER      NOT NULL DEFAULT 0,
  saves        INTEGER      NOT NULL DEFAULT 0,
  extra_data   JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (platform, content_id, scraped_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_platform_date
  ON zenithjoy.daily_snapshots (platform, scraped_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_content
  ON zenithjoy.daily_snapshots (content_id, platform);

ALTER TABLE zenithjoy.daily_snapshots
  ADD COLUMN IF NOT EXISTS saves INTEGER NOT NULL DEFAULT 0;

COMMIT;
