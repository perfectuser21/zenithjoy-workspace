-- PR-e/5：把 zenithjoy.pipeline_runs.topic_id 升级为 UUID + 真 FK
-- Brain Task: 8d802eae-6d83-4ea3-af10-ea60f6f0c752
-- 幂等：
--   - 第一次跑：列是 varchar → 清非法/孤儿 → 改类型 → 加 FK
--   - 第二次跑：列已是 uuid → 清理块跳过（类型守护），FK 已存在跳过

BEGIN;

DO $pre$
BEGIN
  -- 仅当列仍是 varchar 时做文本级清理（uuid 列不支持 !~ 正则比较）
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'zenithjoy'
      AND table_name = 'pipeline_runs'
      AND column_name = 'topic_id'
      AND data_type IN ('character varying', 'text')
  ) THEN
    -- 1. 清理非法 UUID 格式（SET NULL）
    EXECUTE $sql$
      UPDATE zenithjoy.pipeline_runs
      SET topic_id = NULL
      WHERE topic_id IS NOT NULL
        AND topic_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    $sql$;

    -- 2. 清理孤儿引用（topic_id 不存在于 topics 表的 SET NULL）
    EXECUTE $sql$
      UPDATE zenithjoy.pipeline_runs pr
      SET topic_id = NULL
      WHERE topic_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM zenithjoy.topics t WHERE t.id::text = pr.topic_id
        )
    $sql$;

    -- 3. 改类型 varchar → uuid
    EXECUTE 'ALTER TABLE zenithjoy.pipeline_runs
             ALTER COLUMN topic_id TYPE UUID USING topic_id::uuid';
  ELSE
    -- 已是 uuid：仍兜底清理孤儿（按 uuid::text 比较）
    EXECUTE $sql$
      UPDATE zenithjoy.pipeline_runs pr
      SET topic_id = NULL
      WHERE topic_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM zenithjoy.topics t WHERE t.id = pr.topic_id
        )
    $sql$;
  END IF;
END
$pre$;

-- 4. 加 FK 约束（若已存在则跳过）
DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'zenithjoy'
      AND table_name = 'pipeline_runs'
      AND constraint_name = 'fk_pipeline_runs_topic_id'
  ) THEN
    EXECUTE 'ALTER TABLE zenithjoy.pipeline_runs
             ADD CONSTRAINT fk_pipeline_runs_topic_id
             FOREIGN KEY (topic_id)
             REFERENCES zenithjoy.topics(id)
             ON DELETE SET NULL';
  END IF;
END
$fk$;

-- 5. 更新注释
COMMENT ON COLUMN zenithjoy.pipeline_runs.topic_id
  IS '引用 zenithjoy.topics.id（UUID + FK，PR-e/5 加强）';

COMMIT;
