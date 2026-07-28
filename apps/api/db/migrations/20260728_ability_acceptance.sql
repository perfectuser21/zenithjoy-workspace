-- Sprint 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
-- Ability Acceptance: 四张表

-- 验收模板表
CREATE TABLE IF NOT EXISTS acceptance_template (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('FR', 'NFR', 'Invariant', 'SOP')),
    seq INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    description TEXT,
    app_id TEXT,
    line_id TEXT,
    surface TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS acceptance_template_tenant_idx ON acceptance_template (tenant_id);

-- 验收运行表
CREATE TABLE IF NOT EXISTS acceptance_run (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    surface TEXT NOT NULL,
    task_id TEXT NOT NULL,
    sha TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT NOT NULL,
    submitted_at TIMESTAMPTZ,
    UNIQUE (tenant_id, task_id, sha)
);

CREATE INDEX IF NOT EXISTS acceptance_run_tenant_idx ON acceptance_run (tenant_id);

-- 设备结果表
CREATE TABLE IF NOT EXISTS device_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES acceptance_run (run_id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    device_index INTEGER NOT NULL CHECK (device_index BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, device_index)
);

-- 检查结果表
CREATE TABLE IF NOT EXISTS check_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_result_id UUID NOT NULL REFERENCES device_result (id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES acceptance_run (run_id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL,
    template_id TEXT NOT NULL,
    result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('PASS', 'FAIL', 'BLOCKED', 'pending')),
    evidence TEXT,
    checked_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_result_id, template_id)
);
