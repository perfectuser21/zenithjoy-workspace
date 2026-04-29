-- PR-B Free Tier 自动 Onboarding — 允许 licenses.tier='free'
--
-- 主理人 2026-04-29 决策：注册即试用，每人自动 free tenant + 100 积分
--   - 注册不带 license_key → auth-bridge 自动建 tier='free', max_machines=0 license
--   - free license 关联到 plan='free' tenant（tenants 表已支持，无需改）
--   - Agent 注册用 free license 会被 QUOTA_EXCEEDED 拒绝（max_machines=0），符合预期
--
-- 改造：
--   1. 删旧 CHECK 约束 (tier IN ('basic','matrix','studio','enterprise'))
--   2. 加新 CHECK 约束 (tier IN ('free','basic','matrix','studio','enterprise'))
--
-- 兼容：旧数据无 'free' 行 → 加约束不会失败；'free' 是新增枚举值。

BEGIN;

ALTER TABLE zenithjoy.licenses
  DROP CONSTRAINT IF EXISTS licenses_tier_check;

ALTER TABLE zenithjoy.licenses
  ADD CONSTRAINT licenses_tier_check
  CHECK (tier IN ('free','basic','matrix','studio','enterprise'));

COMMIT;
