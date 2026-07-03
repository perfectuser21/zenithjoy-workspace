-- Migration: account_role_unify
-- Sprint: 07032332-line02-account-role-unify
-- Purpose: 将 line02_account_sessions.health 迁移至 agent_platform_sessions.status（三值映射），
--          并为 line02_account_sessions 加停写标记列。
-- 执行顺序：先 --dry-run 确认无冲突，再正式执行本 migration。

-- 1. 加停写标记列（用于应用层切断写入路径）
ALTER TABLE zenithjoy.line02_account_sessions
  ADD COLUMN IF NOT EXISTS write_disabled boolean NOT NULL DEFAULT false;

-- 2. health→status 三值映射：将 line02_account_sessions 现存记录迁入 agent_platform_sessions
--    INSERT ... ON CONFLICT DO NOTHING：已有绑定记录不覆盖（agent_platform_sessions 为权威源）
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
WHERE NOT l.write_disabled
ON CONFLICT (agent_id, platform, account_label) DO NOTHING;

-- 3. 停写：将所有 line02_account_sessions 行标记为 write_disabled=true
UPDATE zenithjoy.line02_account_sessions SET write_disabled = true;
