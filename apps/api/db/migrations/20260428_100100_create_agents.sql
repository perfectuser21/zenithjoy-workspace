-- apps/api/db/migrations/20260428_100100_create_agents.sql
CREATE TABLE IF NOT EXISTS zenithjoy.agents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  agent_id     text NOT NULL UNIQUE,
  hostname     text,
  platform     text,
  capabilities text[] NOT NULL DEFAULT '{}',
  version      text,
  status       text NOT NULL DEFAULT 'offline',
  last_seen    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_agents_status CHECK (status IN ('online', 'offline'))
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant_status ON zenithjoy.agents(tenant_id, status);

COMMENT ON TABLE zenithjoy.agents IS '已注册的本地 Agent，一个租户可有多个 Agent';
