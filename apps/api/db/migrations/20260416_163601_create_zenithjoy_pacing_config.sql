-- 内容工厂节奏配置（每日选题配额等）
-- PR-a（彻底重构 1/5）
-- 幂等：可重复执行
--
-- 字段设计参考：/tmp/pipeline-migration-plan/01-target-schema.md § 2

CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.pacing_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: daily_limit = 1（与 SQLite 旧值一致）
INSERT INTO zenithjoy.pacing_config (key, value) VALUES ('daily_limit', '1')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE zenithjoy.pacing_config IS '内容工厂节奏配置（每日选题配额等）';
