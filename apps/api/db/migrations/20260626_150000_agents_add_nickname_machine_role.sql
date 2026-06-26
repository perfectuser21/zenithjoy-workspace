-- 机器管理 — agents 表加两列（不动现有列、不改 PK）
--
-- nickname      : 运营自定义机器显示名（可空）
-- machine_role  : 机器角色 main/sub（默认 main），与 agent_platform_sessions.role(main/burner) 是两个概念
--
-- 幂等：用 IF NOT EXISTS / information_schema 探测，可重复执行。

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS nickname TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='zenithjoy'
       AND table_name='agents'
       AND column_name='machine_role'
  ) THEN
    ALTER TABLE zenithjoy.agents
      ADD COLUMN machine_role TEXT NOT NULL DEFAULT 'main';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname='chk_agents_machine_role'
       AND conrelid = 'zenithjoy.agents'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agents
      ADD CONSTRAINT chk_agents_machine_role CHECK (machine_role IN ('main','sub'));
  END IF;
END
$$;

COMMENT ON COLUMN zenithjoy.agents.nickname IS '机器显示名，运营自定义（可空）';
COMMENT ON COLUMN zenithjoy.agents.machine_role IS '机器角色 main/sub，与 agent_platform_sessions.role(号角色) 不同概念';
