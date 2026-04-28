-- ZenithJoy works 表 — apps/api 自治 migration（CI 与本地开发用）
--
-- 之前 works 建表 SQL 散落在 docs/database/migrations/，apps/api 不运行它们。
-- 结果：CI 跑 apps/api migrations 时 works 表不存在，后续 ALTER（如 owner_id）
-- 因 ON_ERROR_STOP=0 静默吞错。
--
-- 本 migration 把 works/publish_logs/field_definitions 三个核心表纳入 apps/api 自治流。
-- 字段集合是 services/works.service.ts INSERT/UPDATE 实际引用的最小必要列。
-- content_type 不加 CHECK 约束（与 Zod schema 'text/image/video/article/audio' 解耦），
-- 避免 docs/.../003 与 002 互相打架的历史问题再现。

BEGIN;

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==================== zenithjoy.works ====================

CREATE TABLE IF NOT EXISTS zenithjoy.works (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              VARCHAR(500) NOT NULL,
  body               TEXT,
  body_en            TEXT,
  content_type       VARCHAR(30) NOT NULL,
  cover_image        VARCHAR(500),
  media_files        JSONB,
  platform_links     JSONB,
  status             VARCHAR(20) NOT NULL DEFAULT 'draft',
  account            VARCHAR(50),
  is_featured        BOOLEAN NOT NULL DEFAULT FALSE,
  is_viral           BOOLEAN NOT NULL DEFAULT FALSE,
  custom_fields      JSONB,
  scheduled_at       TIMESTAMPTZ,
  archived_at        TIMESTAMPTZ,
  first_published_at TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_works_status  ON zenithjoy.works(status);
CREATE INDEX IF NOT EXISTS idx_works_type    ON zenithjoy.works(content_type);
CREATE INDEX IF NOT EXISTS idx_works_created ON zenithjoy.works(created_at DESC);

-- ==================== zenithjoy.publish_logs ====================

CREATE TABLE IF NOT EXISTS zenithjoy.publish_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id            UUID NOT NULL REFERENCES zenithjoy.works(id) ON DELETE CASCADE,
  platform           VARCHAR(20) NOT NULL,
  platform_post_id   VARCHAR(100),
  platform_url       VARCHAR(500),
  status             VARCHAR(20) NOT NULL DEFAULT 'pending',
  scheduled_at       TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_publish_logs_work     ON zenithjoy.publish_logs(work_id);
CREATE INDEX IF NOT EXISTS idx_publish_logs_platform ON zenithjoy.publish_logs(platform);
CREATE INDEX IF NOT EXISTS idx_publish_logs_status   ON zenithjoy.publish_logs(status);

-- ==================== zenithjoy.field_definitions ====================

CREATE TABLE IF NOT EXISTS zenithjoy.field_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name    VARCHAR(100) NOT NULL,
  field_type    VARCHAR(20)  NOT NULL,
  options       JSONB,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fields_visible ON zenithjoy.field_definitions(is_visible);
CREATE INDEX IF NOT EXISTS idx_fields_order   ON zenithjoy.field_definitions(display_order);

COMMIT;
