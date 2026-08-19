-- apps/api/db/migrations/20260819_210500_tenants_license_key_default.sql
-- zenithjoy.tenants.license_key 补一个默认值
--
-- 起因：license_key 建表时是 NOT NULL UNIQUE 且**无 DEFAULT**，于是任何
-- `INSERT INTO zenithjoy.tenants (name, plan) ...` 都会撞 not-null 约束。
-- 本 sprint 的合同测试与 E2E 前置全部按这个形状建两家企业的租户行，
-- 现网建租户的代码路径则一直显式传 license_key，所以这个坑只有新写的测试会踩。
--
-- 加 DEFAULT 不改变任何既有写入路径的行为（显式传值时 DEFAULT 不参与），
-- 只是让"不关心 license_key 的场景"能建出一行来。值取 32 位 hex，与既有
-- license_key 一样是随机不可猜的字符串，且 UNIQUE 冲突概率可忽略。

ALTER TABLE zenithjoy.tenants
  ALTER COLUMN license_key SET DEFAULT encode(gen_random_bytes(16), 'hex');
