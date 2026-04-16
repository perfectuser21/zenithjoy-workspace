-- 作品属性配置表（5 行种子数据）
-- PR-a（彻底重构 1/5）
-- 幂等：可重复执行
--
-- 字段设计参考：/tmp/pipeline-migration-plan/01-target-schema.md § 6

CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.properties (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) UNIQUE NOT NULL,
    type        VARCHAR(20) NOT NULL DEFAULT 'text',
    options     JSONB,
    visible     BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO zenithjoy.properties (name, type, options, visible, sort_order) VALUES
    ('type',        'select',       '["deep-posts","broad-posts","short-posts"]'::jsonb, TRUE, 1),
    ('date',        'date',         NULL, TRUE, 2),
    ('word_count',  'number',       NULL, TRUE, 3),
    ('can_upgrade', 'checkbox',     NULL, TRUE, 4),
    ('platforms',   'multi_select', NULL, TRUE, 5)
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE zenithjoy.properties IS '作品属性配置表（dashboard 作品库字段定义）';
