-- Line04 CRM 采集对账 — crm_customers 加软删 + 连续未扫到计数两列
--
-- deleted_at       软删时间戳（可空，NULL=在册）。对账满 K 次未扫到 → now()；扫到即回 NULL 复活。
-- scan_miss_count  连续未被 friend-scan 扫到次数（NOT NULL DEFAULT 0）。扫到即归零。
--
-- 纯 ADD COLUMN IF NOT EXISTS，不动 PK/UNIQUE/外键，无数据迁移，幂等可重入。
ALTER TABLE zenithjoy.crm_customers
  ADD COLUMN IF NOT EXISTS deleted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS scan_miss_count int NOT NULL DEFAULT 0;

COMMENT ON COLUMN zenithjoy.crm_customers.deleted_at IS
  '软删时间戳（对账满 K 次未扫到→now()，扫到→NULL 复活）；GET /customers 排除非空行。';
COMMENT ON COLUMN zenithjoy.crm_customers.scan_miss_count IS
  '连续未被 friend-scan 扫到次数（扫到归零，满 K 触发软删）。';
