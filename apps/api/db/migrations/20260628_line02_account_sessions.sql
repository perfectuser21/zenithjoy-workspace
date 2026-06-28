-- Line02 账号 session 表 — 主号/小号绑定状态
CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.line02_account_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  account_label  text NOT NULL,
  role           text NOT NULL DEFAULT 'main' CHECK (role IN ('main', 'burner')),
  health         text NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'expired', 'unknown')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_line02_sessions_tenant_label UNIQUE (tenant_id, account_label)
);

CREATE INDEX IF NOT EXISTS idx_line02_sessions_tenant ON zenithjoy.line02_account_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_line02_sessions_role   ON zenithjoy.line02_account_sessions(tenant_id, role);

COMMENT ON TABLE zenithjoy.line02_account_sessions IS
  'Line02 账号绑定状态 — 主号(main)和小号(burner) session 健康状态';
