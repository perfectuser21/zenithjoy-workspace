-- Walking Skeleton #1 — 让 zenithjoy.licenses 接受 tier='free'
--
-- 根因：PR-B (#244 free-tier-onboarding) 加了 free tier 代码（auth-bridge 注册即建 free
-- license），但漏了配套的 schema migration。zenithjoy.licenses_tier_check 约束当时只允许
-- ['basic','matrix','studio','enterprise']，所以新注册用户自动建 free license 全被 DB 拒，
-- 后端 [auth-bridge] free fallback DB error 静默吞，dashboard 永远显示占位 license。
--
-- 2026-05-07 lead 自验时发现，hot fix 直接改 DB constraint 让 free 通过 + 给所有 orphan
-- user (better_auth user 没对应 license) 一次性补建 free license。本 migration 把这次
-- schema 修改沉淀进 git，下次新建环境 / 灾备恢复 / 测试库初始化时不会再丢。
--
-- 注意：CI 不会自动跑 migration。lead 手动 `psql -f` 应用。

BEGIN;

-- 1. 删旧 constraint（不允许 'free'）
ALTER TABLE zenithjoy.licenses DROP CONSTRAINT IF EXISTS licenses_tier_check;

-- 2. 加新 constraint（含 'free'）
ALTER TABLE zenithjoy.licenses
  ADD CONSTRAINT licenses_tier_check
  CHECK (tier = ANY (ARRAY['free'::text, 'basic'::text, 'matrix'::text, 'studio'::text, 'enterprise'::text]));

-- 3. 回填：为所有有 better_auth user 但缺 free license 的用户补建一个
INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, customer_id, customer_email, status, issued_at, expires_at)
SELECT
  'ZJ-F-' || upper(substr(md5(u.id || gen_random_uuid()::text), 1, 8)),
  'free',
  1,
  u.id,
  u.email,
  'active',
  now(),
  now() + interval '10 years'
FROM "user" u
LEFT JOIN zenithjoy.licenses l ON l.customer_id = u.id
WHERE l.license_key IS NULL
  AND u.id IS NOT NULL;

COMMIT;

-- 验证：
-- SELECT tier, count(*) FROM zenithjoy.licenses GROUP BY tier;
-- SELECT count(*) FROM "user" u LEFT JOIN zenithjoy.licenses l ON l.customer_id=u.id WHERE l.license_key IS NULL;
