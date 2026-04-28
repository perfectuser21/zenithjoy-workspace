-- ZenithJoy Sprint B · 多租户数据隔离 — works 表 owner_id blueprint
--
-- 加 owner_id（飞书 open_id 字符串，nullable 兼容历史 demo 数据）+ 索引
-- 现有 demo 数据保持 owner_id IS NULL，仅 super-admin bypass 可见
--
-- 后续 sprint 复制本模式到：topics / pipeline_runs / fields / pacing_config 等业务表

BEGIN;

ALTER TABLE zenithjoy.works
  ADD COLUMN IF NOT EXISTS owner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_works_owner ON zenithjoy.works(owner_id);

COMMIT;
