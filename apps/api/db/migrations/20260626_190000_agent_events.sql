-- Line02/Agent 观测 — agent_events 表（统一存 agent 回传的日志/错误/升级进度，thin 第一刀）
--
-- kind=log     → 日志/错误（level=info|warn|error，message=正文）
-- kind=upgrade → 升级进度/结果（phase=download|verify|extract|preflight|activate|done|failed，percent=0-100）
--
-- agent 上报端点用 x-license-key 解析 tenant 落库；dashboard 读端点按 (agent_id,tenant) 双过滤。
-- 纯 CREATE IF NOT EXISTS，幂等可重入，不动既有表。
CREATE TABLE IF NOT EXISTS zenithjoy.agent_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL,
  agent_id   text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('log', 'upgrade')),
  level      text,
  module     text,
  phase      text,
  percent    int,
  message    text,
  context    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_tenant_agent_created
  ON zenithjoy.agent_events (tenant_id, agent_id, created_at DESC);

COMMENT ON TABLE zenithjoy.agent_events IS
  'agent 回传的日志/错误/升级进度（thin）。kind=log/upgrade；读端点按 (agent_id,tenant) 双过滤。';
