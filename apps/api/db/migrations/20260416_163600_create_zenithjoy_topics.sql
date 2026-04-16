-- 选题池（从 services/creator/migrations/001_create_topics.sql SQLite 迁入 Postgres）
-- PR-a（彻底重构 1/5）
-- 幂等：可重复执行
--
-- 字段设计参考：/tmp/pipeline-migration-plan/01-target-schema.md § 1
-- - id 使用 UUID DEFAULT gen_random_uuid()
-- - status 中文枚举 + CHECK 约束
-- - target_platforms 使用 JSONB（取代 SQLite 的 TEXT+JSON 字符串）
-- - scheduled_date 原生 DATE
-- - 加 updated_at 自动 trigger（复用 zenithjoy.update_updated_at_column）

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- 依赖 update_updated_at_column function（若不存在则创建，与 pipeline_runs 保持一致）
CREATE OR REPLACE FUNCTION zenithjoy.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS zenithjoy.topics (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT NOT NULL,
    angle             TEXT,
    priority          INTEGER NOT NULL DEFAULT 100,
    status            VARCHAR(20) NOT NULL DEFAULT '待研究',
    target_platforms  JSONB NOT NULL DEFAULT '["xiaohongshu","douyin","kuaishou","shipinhao","x","toutiao","weibo","wechat"]'::jsonb,
    scheduled_date    DATE,
    pipeline_id       UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at      TIMESTAMPTZ,
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT chk_topics_status CHECK (status IN ('待研究','已通过','研究中','待发布','已发布','已拒绝'))
);

CREATE INDEX IF NOT EXISTS idx_topics_status    ON zenithjoy.topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_priority  ON zenithjoy.topics(priority);
CREATE INDEX IF NOT EXISTS idx_topics_scheduled ON zenithjoy.topics(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_topics_deleted   ON zenithjoy.topics(deleted_at);

DROP TRIGGER IF EXISTS update_topics_updated_at ON zenithjoy.topics;

CREATE TRIGGER update_topics_updated_at
    BEFORE UPDATE ON zenithjoy.topics
    FOR EACH ROW
    EXECUTE FUNCTION zenithjoy.update_updated_at_column();

COMMENT ON TABLE zenithjoy.topics IS '选题池 — 主理人清单驱动的内容源头（彻底重构 PR-a：从 services/creator/data/creator.db 迁入）';
COMMENT ON COLUMN zenithjoy.topics.status IS '待研究/已通过/研究中/待发布/已发布/已拒绝 — 工作流状态';
COMMENT ON COLUMN zenithjoy.topics.pipeline_id IS '指向当前正在执行的 pipeline_runs.id（NULL 表示无）';
