-- 补加 daily_snapshots.saves 列（原建表 migration 有此列但生产 DB 未跑）
ALTER TABLE zenithjoy.daily_snapshots
  ADD COLUMN IF NOT EXISTS saves BIGINT NOT NULL DEFAULT 0;
