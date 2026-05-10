-- Path 2 Sprint B-1 WS1: agent_platform_sessions add role 字段
--
-- 决策 B：复用现有表，加 role TEXT NOT NULL DEFAULT 'main' + CHECK (role IN ('main','burner'))
-- 不新建 burner_sessions 表，避免破坏 Sprint A _smoke-feishu-seed 等已 SELECT 该表的 query。
--
-- 幂等保护：用 information_schema 探测 role 列存在 → 跳过；不存在 → ADD COLUMN 默认 'main'
-- 已存在的 main 行：DEFAULT 'main' 自动 backfill；后续验证 role IS NOT NULL（NOT NULL 约束保证）

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='zenithjoy'
       AND table_name='agent_platform_sessions'
       AND column_name='role'
  ) THEN
    ALTER TABLE zenithjoy.agent_platform_sessions
      ADD COLUMN role TEXT NOT NULL DEFAULT 'main';
  END IF;

  -- CHECK 约束：role IN ('main','burner')；幂等：先 DROP IF EXISTS 再 ADD
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_aps_role'
       AND conrelid = 'zenithjoy.agent_platform_sessions'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agent_platform_sessions
      ADD CONSTRAINT chk_aps_role CHECK (role IN ('main','burner'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_aps_agent_platform_role
  ON zenithjoy.agent_platform_sessions(agent_id, platform, role);

COMMENT ON COLUMN zenithjoy.agent_platform_sessions.role IS
  'Path 2 Sprint B-1：main = Path 1 主号扫码、burner = 小号扫码（后端透明赋值）';
