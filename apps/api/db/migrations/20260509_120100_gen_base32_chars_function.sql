-- Walking Skeleton 2.1f — base32 字符生成 PG function
-- 替代之前 hot-fix migration 用 md5() hex 的做法
-- 后续回填 / generate license 走这个 function
-- 字符集 [A-Z2-9]，与 license.service.ts generateLicenseKey 一致（去 0/1/I/O 易混淆）

BEGIN;

CREATE OR REPLACE FUNCTION zenithjoy.gen_base32_chars(n int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  charset constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  IF n < 1 THEN
    RAISE EXCEPTION 'n must be >= 1';
  END IF;
  FOR i IN 1..n LOOP
    result := result || substr(charset, 1 + floor(random() * length(charset))::int, 1);
  END LOOP;
  RETURN result;
END$$;

COMMENT ON FUNCTION zenithjoy.gen_base32_chars(int)
  IS 'Sprint 2.1f Fix 4 — base32 字符集随机串，license 回填用';

COMMIT;
