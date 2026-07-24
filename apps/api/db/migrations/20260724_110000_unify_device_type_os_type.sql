-- GP-5 INV-1：统一 agents.os_type 与 line02_account_sessions.device_type 值域
-- 旧值域：agents.os_type = win32/darwin/linux；line02_account_sessions.device_type = web/android
-- 新值域统一为：android | windows | unknown
--
-- 幂等：DROP/ADD constraint + 数据迁移（UPDATE）

-- 1. agents.os_type：重命名旧值，删除旧约束，加新约束
UPDATE zenithjoy.agents
  SET os_type = CASE
    WHEN os_type = 'win32' THEN 'windows'
    WHEN os_type IN ('darwin', 'linux') THEN 'unknown'
    ELSE os_type
  END
WHERE os_type IN ('win32', 'darwin', 'linux');

DO $$
BEGIN
  -- 若存在旧约束则先删除
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_agents_os_type'
       AND conrelid = 'zenithjoy.agents'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agents DROP CONSTRAINT chk_agents_os_type;
  END IF;
  -- 添加新约束
  ALTER TABLE zenithjoy.agents
    ADD CONSTRAINT chk_agents_os_type
    CHECK (os_type IN ('android', 'windows', 'unknown'));
END;
$$;

COMMENT ON COLUMN zenithjoy.agents.os_type IS
  'GP-5 INV-1 统一值域：android | windows | unknown（原 win32→windows, darwin/linux→unknown）';

-- 2. line02_account_sessions.device_type：扩展值域加 windows/unknown
DO $$
BEGIN
  -- 先删除旧约束（原值域 web/android）
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_aps_device_type'
       AND conrelid = 'zenithjoy.agent_platform_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agent_platform_sessions DROP CONSTRAINT chk_aps_device_type;
  END IF;

  -- line02_account_sessions 若有 device_type CHECK 也删除
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_line02_device_type'
       AND conrelid = 'zenithjoy.line02_account_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.line02_account_sessions DROP CONSTRAINT chk_line02_device_type;
  END IF;
END;
$$;

-- line02_account_sessions 加 device_type 列（若不存在）
ALTER TABLE zenithjoy.line02_account_sessions
  ADD COLUMN IF NOT EXISTS device_type text NOT NULL DEFAULT 'android';

-- 统一约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_line02_device_type'
       AND conrelid = 'zenithjoy.line02_account_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.line02_account_sessions
      ADD CONSTRAINT chk_line02_device_type
      CHECK (device_type IN ('android', 'windows', 'unknown'));
  END IF;

  -- 重建 agent_platform_sessions device_type 约束（扩展 web/android → android/windows/unknown/web）
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_aps_device_type'
       AND conrelid = 'zenithjoy.agent_platform_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agent_platform_sessions
      ADD CONSTRAINT chk_aps_device_type
      CHECK (device_type IN ('android', 'windows', 'unknown', 'web'));
  END IF;
END;
$$;

COMMENT ON COLUMN zenithjoy.line02_account_sessions.device_type IS
  'GP-5 INV-1：账号来源设备类型，统一值域 android | windows | unknown';
