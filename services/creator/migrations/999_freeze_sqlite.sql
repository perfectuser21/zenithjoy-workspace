-- Migration 999: 冻结 SQLite（PR-d/5 彻底重构）
--
-- 目的：在 cutover 完成后，让 SQLite 侧的 topics 表不可写、读返回空。
-- 防止万一有遗漏的代码路径意外回读 SQLite 继续用老数据，
-- 得到空结果立即暴露问题（而不是悄悄发布过期内容）。
--
-- 执行时机：主理人在本地跑完 scripts/migrate-sqlite-to-pg.py --apply 之后，
--           手动执行一次：
--             sqlite3 services/creator/data/creator.db < services/creator/migrations/999_freeze_sqlite.sql
--           apply-migrations.py 会通过 schema_migrations 表防止重复执行。
--
-- 回滚：
--   BEGIN;
--   DROP VIEW IF EXISTS topics;
--   ALTER TABLE topics_frozen_20260416 RENAME TO topics;
--   COMMIT;
--
-- 注意：
-- - pacing_config 不冻结。PR-a 的 Postgres seed 已经和 SQLite 等值（daily_limit=1），
--   将来若需要可直接删 SQLite 侧，或照此方式再加一个 freeze migration。
-- - 执行后 SQLite 里的业务数据仍保留在 topics_frozen_20260416 中，作为兜底副本；
--   物理删除由 PR-e 之后 7 天完成。

BEGIN TRANSACTION;

-- 1. 把现有 topics 表改名为 topics_frozen_20260416（业务数据仍保留，仅从代码路径隐藏）
ALTER TABLE topics RENAME TO topics_frozen_20260416;

-- 2. 建一个同名 VIEW，永远返回空（任何 SELECT 返回 0 行，任何 INSERT/UPDATE 报错）
--    字段 + 类型与原表一致，这样代码 SELECT * 不会因 schema drift 爆异常
CREATE VIEW topics AS
SELECT
    CAST(NULL AS TEXT)    AS id,
    CAST(NULL AS TEXT)    AS title,
    CAST(NULL AS TEXT)    AS angle,
    CAST(NULL AS INTEGER) AS priority,
    CAST(NULL AS TEXT)    AS status,
    CAST(NULL AS TEXT)    AS target_platforms,
    CAST(NULL AS TEXT)    AS scheduled_date,
    CAST(NULL AS TEXT)    AS pipeline_id,
    CAST(NULL AS TEXT)    AS created_at,
    CAST(NULL AS TEXT)    AS updated_at,
    CAST(NULL AS TEXT)    AS published_at,
    CAST(NULL AS TEXT)    AS deleted_at
WHERE 1 = 0;

-- 3. 把原表上的索引名也释放出来（view 不需要索引，避免和 PR-a 迁移命名冲突）
--    原索引随 RENAME 自动跟到 topics_frozen_20260416 上，这里无需额外处理。

COMMIT;
