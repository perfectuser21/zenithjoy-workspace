-- 选题池 v1：为 pipeline_runs 增加 topic_id 反向引用
-- Brain Task: 4aac48fe-048a-4f82-9750-57e6614e0c62
-- 幂等：可重复执行

ALTER TABLE zenithjoy.pipeline_runs
    ADD COLUMN IF NOT EXISTS topic_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_topic_id
    ON zenithjoy.pipeline_runs(topic_id);

COMMENT ON COLUMN zenithjoy.pipeline_runs.topic_id IS '反向引用 services/creator topics 表的 id（选题池 v1）';
