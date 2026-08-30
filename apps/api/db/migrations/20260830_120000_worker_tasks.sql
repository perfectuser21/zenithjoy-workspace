-- 工作机控制塔可视化·第一刀（决策 e14297d4）：worker 活动协议正表。
-- 与 publish_tasks 完全隔离（安卓 Agent 心跳只拉 publish_tasks，不会误领这里的任务）。
-- 失败信息写正表列（failed_step / error_code），不藏 JSONB——四次盲修的教训。
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不在此文件内包 BEGIN/COMMIT：run-migration.ts 的 applyMigration 已经把整份文件内容
-- 包在一个外层事务里执行（BEGIN → client.query(sql) → COMMIT），文件内再嵌套一层
-- BEGIN/COMMIT 会在外层事务中途提前提交，破坏「整份 migration 要么全上要么全不上」的原子性。

CREATE TABLE IF NOT EXISTS zenithjoy.worker_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  agent_id      UUID NOT NULL REFERENCES zenithjoy.agents(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  executor_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'needs_review')),
  steps_total   INTEGER NOT NULL DEFAULT 0,
  current_step  INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  failed_step   INTEGER,
  error_code    TEXT,
  lease_until   TIMESTAMPTZ NOT NULL,
  evidence      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tasks_running_per_agent
  ON zenithjoy.worker_tasks (agent_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_worker_tasks_tenant_agent_started
  ON zenithjoy.worker_tasks (tenant_id, agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_tasks_running_lease
  ON zenithjoy.worker_tasks (lease_until) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS zenithjoy.worker_task_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES zenithjoy.worker_tasks(id) ON DELETE CASCADE,
  step_index     INTEGER NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'doing', 'done', 'failed')),
  screenshot_ref TEXT,
  foreground_pkg TEXT,
  diag_line TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, step_index)
);
