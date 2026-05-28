-- operator_sessions: stores platform login session state for the 8 operator accounts
-- status is constrained to: active / expired / missing
CREATE TABLE IF NOT EXISTS operator_sessions (
    id             BIGSERIAL PRIMARY KEY,
    platform       TEXT        NOT NULL UNIQUE,
    secret_name    TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'missing'
                               CONSTRAINT check_operator_session_status
                               CHECK (status IN ('active', 'expired', 'missing')),
    last_checked_at TIMESTAMPTZ,
    last_valid_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_platform ON operator_sessions (platform);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_status   ON operator_sessions (status);
