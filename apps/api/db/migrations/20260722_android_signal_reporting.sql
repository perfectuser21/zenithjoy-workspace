-- FR-1a: UIA 在线状态双信号列
-- agent_platform_sessions 扩展四列，记录 UIA（UIAutomator）探测到的在线状态
-- updated_at 列新增（此前 agent_platform_sessions 只有 bound_at/created_at），供排序与增量查询使用
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS uia_online     BOOLEAN     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_checked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS uia_error      TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ DEFAULT NULL;
