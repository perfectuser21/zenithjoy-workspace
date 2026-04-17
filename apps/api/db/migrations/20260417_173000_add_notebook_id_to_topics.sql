-- 阶段 A+：topics 加 notebook_id 字段
-- 允许主理人给每个 topic 指定 NotebookLM notebook ID，research 阶段用。
-- 为空时 pipeline-worker 会 fallback 到 env CREATOR_DEFAULT_NOTEBOOK_ID。
-- 幂等：可重复执行

ALTER TABLE zenithjoy.topics
  ADD COLUMN IF NOT EXISTS notebook_id VARCHAR(100);

COMMENT ON COLUMN zenithjoy.topics.notebook_id IS 'NotebookLM notebook ID，research 阶段用。为空时 fallback 到 env CREATOR_DEFAULT_NOTEBOOK_ID';
