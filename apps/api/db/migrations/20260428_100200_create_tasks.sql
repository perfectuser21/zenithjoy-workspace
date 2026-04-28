-- apps/api/db/migrations/20260428_100200_create_tasks.sql
CREATE TABLE IF NOT EXISTS zenithjoy.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  agent_id     uuid REFERENCES zenithjoy.agents(id) ON DELETE SET NULL,
  agent_text   text,
  skill        text NOT NULL,
  params       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'pending',
  result       jsonb,
  error        text,
  scheduled_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_tasks_status CHECK (status IN ('pending', 'running', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status ON zenithjoy.tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON zenithjoy.tasks(agent_id, status) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_created ON zenithjoy.tasks(tenant_id, created_at DESC);

COMMENT ON TABLE zenithjoy.tasks IS '任务队列 — 云端创建，派发到 Agent 执行';
