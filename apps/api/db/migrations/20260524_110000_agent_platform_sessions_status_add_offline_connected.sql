-- apps/api/db/migrations/20260524_110000_agent_platform_sessions_status_add_offline_connected.sql
-- 扩展 agent_platform_sessions.status CHECK 约束，加入 offline / connected
--
-- 背景：ws2 合同 offline test 使用 UPDATE status='offline' 标记下线，
--       恢复使用 UPDATE status='connected'。
--       原约束 ('pending','active','expired') 缺这两个值，
--       导致 UPDATE 静默失败（|| true），offline 判断失效。
--
-- 幂等保护：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT

BEGIN;

ALTER TABLE zenithjoy.agent_platform_sessions
  DROP CONSTRAINT IF EXISTS chk_aps_status;

ALTER TABLE zenithjoy.agent_platform_sessions
  ADD CONSTRAINT chk_aps_status CHECK (
    status IN ('pending', 'active', 'connected', 'offline', 'expired')
  );

COMMIT;
