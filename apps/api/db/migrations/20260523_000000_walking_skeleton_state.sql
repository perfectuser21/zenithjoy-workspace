-- Migration: Walking Skeleton State Tables
-- Created: 2026-05-23
-- Purpose: 存储 Harness Sprint State Sync 的本地快照，供 Brain API 读写

-- Sprint state 快照表（每次 Harness 跑完写一条）
CREATE TABLE IF NOT EXISTS zenithjoy.sprint_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    TEXT NOT NULL,        -- e.g. 'path-1', 'cecelia-harness'
  sprint_id     TEXT NOT NULL,        -- e.g. 'sprint-0523'
  snapshot      JSONB NOT NULL,       -- 完整快照 {steps, features, apis, db_schema, tests}
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Journey Step 状态表（每个 Journey 里每个 Step 的当前状态）
CREATE TABLE IF NOT EXISTS zenithjoy.journey_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    TEXT NOT NULL,
  step_id       TEXT NOT NULL,        -- e.g. 'P1-S1', 'H-S3', 'S-AUTH'
  step_order    INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started/in_progress/passing/done
  shared        BOOLEAN DEFAULT false,
  notion_page_id TEXT,               -- 对应 Journey-Step 连接表的 Notion page ID
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(journey_id, step_id)
);

-- Feature 状态表
CREATE TABLE IF NOT EXISTS zenithjoy.sprint_features (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    TEXT NOT NULL,
  step_id       TEXT NOT NULL,
  feature_name  TEXT NOT NULL,
  thickness     TEXT NOT NULL DEFAULT 'thin',  -- thin/medium/thick
  status        TEXT NOT NULL DEFAULT 'not_started',
  sprint_id     TEXT,
  notion_page_id TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(journey_id, feature_name)
);

CREATE INDEX IF NOT EXISTS idx_sprint_states_journey_id    ON zenithjoy.sprint_states(journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_steps_journey_id    ON zenithjoy.journey_steps(journey_id);
CREATE INDEX IF NOT EXISTS idx_sprint_features_journey_id  ON zenithjoy.sprint_features(journey_id);
