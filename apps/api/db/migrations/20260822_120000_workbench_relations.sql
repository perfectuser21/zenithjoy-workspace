-- 路③ 结构化工作台 Sprint D —— S4 跨表关联（relation 字段类型）
--
-- 设计口径（合同 concern②「零新建关联表」+ Invariant③「无运行时 DDL」逐条）：
--   * 关联值存 db_rows.data JSONB（目标 row_id 数组），目标表配置存 db_fields.options[0]，
--     **不新建任何关联/连接物理表**。本 migration 只做两件事：把 relation 加进 db_fields
--     的 field_type 白名单、给 db_fields 加软删列。零建表语句（关联不进标识符位）。
--   * db_fields.deleted_at 软删列（A30③ 删字段 = 软删元数据 + 值保留）：删字段只打
--     deleted_at，db_rows.data 里旧关联值一条不动，物理行保留。
--   * 全部 DDL 幂等（IF NOT EXISTS / DROP-then-ADD 守卫）：CI 重放全部 migration，
--     非幂等语句第二次必炸。

BEGIN;

-- ==================== 1. db_fields 加软删列（A30③ 删字段 = 软删）====================

ALTER TABLE zenithjoy.db_fields
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 活字段查询走 deleted_at IS NULL：给它一个部分索引，字段列表/候选/反查都吃得到
CREATE INDEX IF NOT EXISTS idx_db_fields_table_live
  ON zenithjoy.db_fields(table_id, display_order) WHERE deleted_at IS NULL;

-- ==================== 2. field_type 白名单纳入 relation ====================
--
-- 把既有 db_fields_type_chk 换成含 relation 的新版（DROP-then-ADD，幂等：先删同名约束
-- 再按九类重建）。relation 是第九类**内部**字段类型，只经服务端登记，用户仍从八类里挑；
-- 但库层 CHECK 必须放行 relation，否则 INSERT relation 字段直接被约束打回。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'db_fields_type_chk') THEN
    ALTER TABLE zenithjoy.db_fields DROP CONSTRAINT db_fields_type_chk;
  END IF;
  ALTER TABLE zenithjoy.db_fields
    ADD CONSTRAINT db_fields_type_chk CHECK (field_type IN (
      'text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'person', 'url', 'relation'
    ));
END $$;

COMMIT;
