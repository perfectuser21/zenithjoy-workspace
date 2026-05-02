-- publish_logs 补充 response 列
-- 原 migration (20260210) 漏了 response 字段，但 publish.service.ts 的 INSERT/UPDATE
-- 均引用该列。integration test 暴露此 schema 漂移，补此 migration 修复。

BEGIN;

ALTER TABLE zenithjoy.publish_logs
  ADD COLUMN IF NOT EXISTS response JSONB;

COMMIT;
