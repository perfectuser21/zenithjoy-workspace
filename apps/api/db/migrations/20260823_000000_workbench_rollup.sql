-- 路③ 结构化工作台 Sprint E —— S4 加厚 rollup/lookup 聚合（rollup/lookup 字段类型）
--
-- 设计口径（合同 Invariant③「无运行时 DDL」+ 范围「零新建表」逐条）：
--   * rollup 采**读时计算不落库**：聚合值不物化进任何物理表，配置以位序三元组
--     `[relation_field_id, target_field_id, aggregate_fn]` 存 db_fields.options（JSONB，Sprint D
--     relation 已用 options[0] 有先例）。**不新建任何 rollup/聚合物理表**。
--   * 本 migration 只做一件事：把 rollup / lookup 加进 db_fields 的 field_type 白名单 CHECK
--     （DROP-then-ADD 幂等，与 Sprint D relation 同法）。零建表语句（聚合不进标识符位）。
--   * 全部 DDL 幂等：CI 重放全部 migration，非幂等语句第二次必炸。

BEGIN;

-- ==================== field_type 白名单纳入 rollup / lookup ====================
--
-- 把既有 db_fields_type_chk 换成含 rollup/lookup 的新版（DROP-then-ADD，幂等：先删同名约束
-- 再按十一类重建）。rollup / lookup 是第十/十一类**内部**字段类型，只经服务端登记
-- （用户仍从八类里挑普通字段），但库层 CHECK 必须放行它们，否则 INSERT rollup 字段直接
-- 被约束打回。八类 + relation（Sprint D）+ rollup + lookup（本刀）= 十一类。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'db_fields_type_chk') THEN
    ALTER TABLE zenithjoy.db_fields DROP CONSTRAINT db_fields_type_chk;
  END IF;
  ALTER TABLE zenithjoy.db_fields
    ADD CONSTRAINT db_fields_type_chk CHECK (field_type IN (
      'text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'person', 'url',
      'relation', 'rollup', 'lookup'
    ));
END $$;

COMMIT;
