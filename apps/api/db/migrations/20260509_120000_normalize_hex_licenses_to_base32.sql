-- Walking Skeleton 2.1f — 历史 hex license 兼容
-- Fix 3 改正则后所有历史 license 都符合 [A-Z0-9]，无需 UPDATE。
-- 这条 migration 留作 audit trail + 一致性 check
--
-- 注意：此 migration 字典序在 20260509_120100_gen_base32_chars_function.sql 之前，
-- 所以不能依赖 zenithjoy.gen_base32_chars 函数。本 migration 仅做检查不做回填。

BEGIN;

DO $$
DECLARE
  invalid_count int;
BEGIN
  SELECT count(*) INTO invalid_count
  FROM zenithjoy.licenses
  WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$'
    AND license_key NOT LIKE 'ZJ-TUSMOKE-%';

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % licenses 不符 [A-Z0-9] 正则，请人工检查', invalid_count;
  END IF;

  RAISE NOTICE 'All licenses 符合新 [A-Z0-9] 正则';
END$$;

COMMIT;
