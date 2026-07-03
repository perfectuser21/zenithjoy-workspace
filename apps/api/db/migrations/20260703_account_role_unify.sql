-- Migration: account_role_unify
-- Sprint: 07032332-line02-account-role-unify
-- Purpose: (1) line02_account_sessions 补 agent_id + platform 列（关联 agents）
--          (2) 加 write_disabled 停写标记列
--          (3) 将 health→status 三值映射迁移到 agent_platform_sessions
-- 策略：DDL 步骤在 DO 外执行，DML 步骤在 DO 内动态执行（确保 DDL 对 DML 可见）

-- 步骤 1: 补关联字段
ALTER TABLE zenithjoy.line02_account_sessions
  ADD COLUMN IF NOT EXISTS agent_id  uuid REFERENCES zenithjoy.agents(id) ON DELETE CASCADE;

ALTER TABLE zenithjoy.line02_account_sessions
  ADD COLUMN IF NOT EXISTS platform  text NOT NULL DEFAULT 'douyin';

-- 步骤 2: 加停写标记列
ALTER TABLE zenithjoy.line02_account_sessions
  ADD COLUMN IF NOT EXISTS write_disabled boolean NOT NULL DEFAULT false;

-- 步骤 3: health→status 三值映射（DO 块内动态执行，确保新列对 SELECT 可见）
DO $$
BEGIN
  -- 仅迁移有 agent_id 关联、且未停写的行
  INSERT INTO zenithjoy.agent_platform_sessions
    (agent_id, platform, account_label, role, status, created_at, bound_at)
  SELECT
    l.agent_id,
    l.platform,
    l.account_label,
    'burner' AS role,
    CASE l.health
      WHEN 'ok'      THEN 'active'
      WHEN 'expired' THEN 'expired'
      ELSE                'pending'
    END AS status,
    NOW() AS created_at,
    NOW() AS bound_at
  FROM zenithjoy.line02_account_sessions l
  WHERE l.agent_id IS NOT NULL
    AND NOT l.write_disabled
  ON CONFLICT (agent_id, platform, account_label) DO NOTHING;

  -- 步骤 4: 停写所有现存行
  UPDATE zenithjoy.line02_account_sessions SET write_disabled = true;
END;
$$;
