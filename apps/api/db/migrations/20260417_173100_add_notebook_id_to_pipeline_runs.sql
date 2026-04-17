-- 阶段 A+：pipeline_runs 加 notebook_id 字段
-- trigger 时从 topic.notebook_id 复制过来，方便 pipelines-worker GET /running 端点
-- 一起返给 pipeline-worker（Python）不用再做 JOIN。
-- 幂等：可重复执行

ALTER TABLE zenithjoy.pipeline_runs
  ADD COLUMN IF NOT EXISTS notebook_id VARCHAR(100);

COMMENT ON COLUMN zenithjoy.pipeline_runs.notebook_id IS '从 topic 复制过来，方便 worker 直接读';
