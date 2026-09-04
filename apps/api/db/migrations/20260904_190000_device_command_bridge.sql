-- OpenClaw 信号桥·件2（决策 7a4c0369）：设备指令桥两张表。
-- remote_control_config：租户远程协助开关 + 频控额度。无行 = enabled 默认 true（Alex 拍板），
--   fail-closed 只针对故障态（查询异常拒绝，见 routes/devices.ts）。
-- device_command_log：指令审计 + 频控数据源。行在 dispatch 前 INSERT（status='pending'，
--   频控 count 含 pending 行，防 TOCTOU），回执后 UPDATE ok/error_code/latency_ms/status。
--   隐私优先：不落 args（type 的 text 等），审计只到 action 名（prep-prd 红线 5 显式取舍）。
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

CREATE TABLE IF NOT EXISTS zenithjoy.remote_control_config (
  tenant_id           TEXT PRIMARY KEY,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  actions_per_minute  INTEGER NOT NULL DEFAULT 60,
  taps_per_minute     INTEGER NOT NULL DEFAULT 30,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zenithjoy.device_command_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  agent_id    UUID NOT NULL,
  msg_id      TEXT NOT NULL UNIQUE,
  action      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  ok          BOOLEAN,
  error_code  TEXT,
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 频控窗口查询按 (tenant, agent, 时间窗) 数行
CREATE INDEX IF NOT EXISTS idx_device_command_log_tenant_agent_created
  ON zenithjoy.device_command_log (tenant_id, agent_id, created_at);
