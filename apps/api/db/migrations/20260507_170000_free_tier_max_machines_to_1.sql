-- Walking Skeleton #1 — 让 free tier 客户能跑 Agent
--
-- 之前 TIER_QUOTA.free = 0 → max_machines=0 写入历史 free license 行
--   → Agent heartbeat 必撞 QUOTA_EXCEEDED → walking skeleton 客户视角第一刀断
-- 改 free=1，让"注册即试用 1 台 Agent" 真贯通。
--
-- 此 migration 把现有所有 max_machines=0 的 free license 同步成 1，
-- 与代码改动（apps/api/src/services/license.service.ts 中 TIER_QUOTA.free=1）配套。
--
-- 不修改 max_machines>0 的行（admin 可能手动加配额给个别客户，不应被覆盖）。

BEGIN;
UPDATE zenithjoy.licenses
   SET max_machines = 1, updated_at = now()
 WHERE tier = 'free' AND max_machines = 0;
COMMIT;

-- 注意：CI 不会自动应用 migration。部署到生产/staging 时由 lead 手动执行：
--   psql -h <host> -U <user> -d <db> -f apps/api/db/migrations/20260507_170000_free_tier_max_machines_to_1.sql
