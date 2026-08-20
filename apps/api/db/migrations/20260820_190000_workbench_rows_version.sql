-- 路③ 结构化工作台 Sprint B —— db_rows 增量：行级乐观锁 version + 建行人 created_by
--
-- 为什么是增量而不是回改 A 刀那份 migration：`20260820_120000_structured_workbench.sql`
-- 已经合进 main 并跑过生产/CI，A 刀 smoke 对它的形状有断言；回改已应用的文件在
-- schema_migrations 里不会重跑，只会让「文件内容」与「库里真实形状」分叉。
--
-- version 的语义（合同判定点 J2）：行级乐观锁基线。建行时 = 1，每次成功 PATCH +1；
-- 带条件 UPDATE（... WHERE version = $基线）的 rowCount 就是「有没有发生并发冲突」的判据。
-- 用 updated_at 时间戳代替它分辨不出同秒内的两次提交，那正是静默覆盖的入口。
--
-- DEFAULT 1 而不是 DEFAULT 0：A 刀已落库的历史行（若有）与新建行必须走同一条基线口径，
-- 前端第一次写回带的基线就是建行响应里的 version。
--
-- 全部 DDL 幂等（ADD COLUMN IF NOT EXISTS）：CI 会重放全部 migration，非幂等语句第二次必炸。

BEGIN;

ALTER TABLE zenithjoy.db_rows
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- 建行人（better-auth user.id / 飞书 open_id）。可空：A 刀已落库的行没有这个信息，
-- 强行 NOT NULL 就得编一个假值填进去，那比空着更糟。
ALTER TABLE zenithjoy.db_rows
  ADD COLUMN IF NOT EXISTS created_by TEXT;

-- 回收站按 deleted_at 倒序列行；活行列表按 (table_id, row_order) 走既有 idx_db_rows_table。
CREATE INDEX IF NOT EXISTS idx_db_rows_trash
  ON zenithjoy.db_rows(table_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

COMMIT;
