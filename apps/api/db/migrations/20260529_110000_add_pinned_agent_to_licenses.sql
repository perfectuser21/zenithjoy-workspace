-- licenses 表加 pinned_agent_id：账号绑定的机器，任务永远只派给这台
-- 首次心跳自动 pin，换机器走 POST /api/agent/repin

ALTER TABLE zenithjoy.licenses
  ADD COLUMN IF NOT EXISTS pinned_agent_id UUID REFERENCES zenithjoy.agents(id) ON DELETE SET NULL;

-- 把现有数据迁移：每条 license 取心跳最新的 win32 agent 作为初始 pinned
UPDATE zenithjoy.licenses l
SET pinned_agent_id = (
  SELECT a.id
  FROM zenithjoy.agents a
  WHERE a.license_id = l.id
    AND a.last_heartbeat_at IS NOT NULL
  ORDER BY
    CASE WHEN a.os_type = 'win32' THEN 0 ELSE 1 END ASC,
    a.last_heartbeat_at DESC NULLS LAST
  LIMIT 1
)
WHERE l.pinned_agent_id IS NULL;
