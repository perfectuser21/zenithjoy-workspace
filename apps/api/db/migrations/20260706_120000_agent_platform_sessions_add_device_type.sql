-- 机器管理：安卓设备账号模型（Sprint 07061204）
--
-- agent_platform_sessions 加 device_type 列，区分 Web 小号会话 vs Android 设备扫描到的账号。
-- 默认 'web'（既有行全部视为 Web），新写入行由 Generator 调用方显式传 'android'。
--
-- 不动既有列（agent_id/platform/account_label/role/status/bound_at/created_at）与既有
-- CHECK 约束（chk_aps_role/chk_aps_status）、既有 UNIQUE(agent_id, platform, account_label)。
--
-- 幂等：IF NOT EXISTS 保护，可重复执行。

ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_aps_device_type'
       AND conrelid = 'zenithjoy.agent_platform_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agent_platform_sessions
      ADD CONSTRAINT chk_aps_device_type CHECK (device_type IN ('web', 'android'));
  END IF;
END
$$;

COMMENT ON COLUMN zenithjoy.agent_platform_sessions.device_type IS
  'Sprint 07061204：账号扫描来源设备类型。web = 既有 Chrome 小号扫码会话（默认）；android = 安卓设备账号扫描上报。';
