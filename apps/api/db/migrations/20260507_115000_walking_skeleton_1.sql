-- Walking Skeleton #1 — 客户首次成功路径（抖音版）
--
-- 三个改动：
--   1. 扩展 zenithjoy.agents 表，加 license_id / bound_folder_path / last_heartbeat_at
--      （现有列保留，向后兼容；license_id 允许 NULL 兼容历史 v1.1 注册数据）
--   2. 新建 zenithjoy.agent_platform_sessions（每平台扫码绑定状态）
--   3. 新建 zenithjoy.publish_tasks（云端 → Agent 任务队列；包含 publish 与 folder_bind / qr_bind）
--
-- 状态机：
--   publish_tasks.status：pending → running → (success | failed)
--   agent_platform_sessions.status：pending → active → expired
--
-- 契约来源：Walking Skeleton #1 contract 第 3 节（/tmp/walking-skeleton-1-contract.md）

BEGIN;

-- ==================== 1. agents 扩展 ====================

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS license_id        UUID REFERENCES zenithjoy.licenses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bound_folder_path TEXT,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agents_license_id ON zenithjoy.agents(license_id);

COMMENT ON COLUMN zenithjoy.agents.license_id IS 'WS#1：发心跳的 license（也是 license_machines 的 license）';
COMMENT ON COLUMN zenithjoy.agents.bound_folder_path IS 'WS#1：用户在 Dashboard 绑定的本地视频文件夹绝对路径';
COMMENT ON COLUMN zenithjoy.agents.last_heartbeat_at IS 'WS#1：最近一次 /api/agent/heartbeat 时刻（独立于旧 last_seen 字段）';

-- ==================== 2. agent_platform_sessions ====================

CREATE TABLE IF NOT EXISTS zenithjoy.agent_platform_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES zenithjoy.agents(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,                          -- 'douyin' | 'kuaishou' | ...
  account_label TEXT NOT NULL DEFAULT 'default',
  bound_at      TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'pending',         -- pending | active | expired
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, platform, account_label),
  CONSTRAINT chk_aps_status CHECK (status IN ('pending', 'active', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_aps_agent_platform
  ON zenithjoy.agent_platform_sessions(agent_id, platform);

COMMENT ON TABLE zenithjoy.agent_platform_sessions IS
  'WS#1：Agent 在每个平台（抖音/快手/...）的扫码绑定状态。session 文件本体在 Agent 本地 ~/.zenithjoy-agent/sessions/<platform>/<account>.json';

-- ==================== 3. publish_tasks ====================

CREATE TABLE IF NOT EXISTS zenithjoy.publish_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES zenithjoy.agents(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,                            -- 'douyin' / 'folder_bind' / 'qr_bind:douyin' ...
  status      TEXT NOT NULL DEFAULT 'pending',          -- pending | running | success | failed
  folder_path TEXT,
  result      JSONB,
  receipt_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_publish_tasks_status CHECK (status IN ('pending', 'running', 'success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_publish_tasks_agent_status
  ON zenithjoy.publish_tasks(agent_id, status);

COMMENT ON TABLE zenithjoy.publish_tasks IS
  'WS#1：云端派给 Agent 的任务队列。platform 字段也用来编码控制类任务（folder_bind / qr_bind:douyin）';

COMMIT;
