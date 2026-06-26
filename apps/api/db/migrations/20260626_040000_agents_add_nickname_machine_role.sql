-- 机器管理模块 — agents 加 nickname + machine_role
--
-- 背景：运营需要在「机器管理」页给机器起人话名（nickname）+ 标主机器/副机器（machine_role）。
-- agents 表原本只有 hostname / status / version，缺这两列。
--
-- 决策：复用现有 zenithjoy.agents 表，加两列：
--   nickname     TEXT NULL              — 人话名；空时后端回填 hostname（COALESCE(nickname, hostname)）
--   machine_role TEXT NOT NULL 'sub'    — 主/副角色，CHECK IN ('main','sub')，默认 sub
--
-- 幂等：列用 ADD COLUMN IF NOT EXISTS；CHECK 约束用 pg_constraint 探测后再 ADD。

-- 1. nickname 列（可空，默认 NULL；展示时 COALESCE(nickname, hostname)）
ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 2. machine_role 列（默认 'sub'）
ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS machine_role TEXT NOT NULL DEFAULT 'sub';

-- 3. CHECK 约束：machine_role IN ('main','sub')（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_agents_machine_role'
       AND conrelid = 'zenithjoy.agents'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agents
      ADD CONSTRAINT chk_agents_machine_role CHECK (machine_role IN ('main','sub'));
  END IF;
END
$$;

COMMENT ON COLUMN zenithjoy.agents.nickname IS '机器人话名（运营自定义）；空时展示回填 hostname';
COMMENT ON COLUMN zenithjoy.agents.machine_role IS '机器角色 main(主机器)/sub(副机器)，默认 sub';
