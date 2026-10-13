-- 扩展已有公司真身；不重建两份历史迁移里的表，不修改订单/发送事实。
ALTER TABLE zenithjoy.tenant_company_profiles
  ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS company_key text,
  ADD COLUMN IF NOT EXISTS wiki jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS runtime_config jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS config_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS config_owner text,
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_company_id ON zenithjoy.tenant_company_profiles(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_company_key ON zenithjoy.tenant_company_profiles(company_key);
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_identity ON zenithjoy.tenant_company_profiles(company_id,tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_line ON zenithjoy.tenant_company_profiles((runtime_config->'routing'->>'line_key')) WHERE runtime_config->'routing'->>'line_key' IS NOT NULL;

CREATE TABLE IF NOT EXISTS zenithjoy.company_config_versions (
  company_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  tenant_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,version),
  UNIQUE(company_id,version,tenant_id),
  FOREIGN KEY(company_id,tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id,tenant_id),
  CHECK(snapshot->>'company_id'=company_id::text AND snapshot->>'tenant_id'=tenant_id::text AND (snapshot->>'version')::integer=version)
);
CREATE TABLE IF NOT EXISTS zenithjoy.company_config_runs (
  company_id uuid NOT NULL,
  run_id text NOT NULL CHECK(run_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$'),
  version integer NOT NULL,
  tenant_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  task_inputs jsonb NOT NULL DEFAULT '{}',
  source_run text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,run_id),
  FOREIGN KEY(company_id,version,tenant_id) REFERENCES zenithjoy.company_config_versions(company_id,version,tenant_id)
);
ALTER TABLE zenithjoy.company_config_runs ADD COLUMN IF NOT EXISTS task_inputs jsonb NOT NULL DEFAULT '{}';
ALTER TABLE zenithjoy.company_config_runs ADD COLUMN IF NOT EXISTS source_run text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zenithjoy.company_config_versions'::regclass AND conname='company_version_snapshot_shape') THEN
    ALTER TABLE zenithjoy.company_config_versions ADD CONSTRAINT company_version_snapshot_shape CHECK (
      jsonb_typeof(snapshot)='object' AND snapshot ?& ARRAY['company_id','tenant_id','version']
      AND snapshot->>'company_id'=company_id::text AND snapshot->>'tenant_id'=tenant_id::text AND (snapshot->>'version')::integer=version
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zenithjoy.company_config_runs'::regclass AND conname='company_run_snapshot_shape') THEN
    ALTER TABLE zenithjoy.company_config_runs ADD CONSTRAINT company_run_snapshot_shape CHECK (
      jsonb_typeof(snapshot)='object' AND snapshot ?& ARRAY['company_id','tenant_id','version']
      AND snapshot->>'company_id'=company_id::text AND snapshot->>'tenant_id'=tenant_id::text AND (snapshot->>'version')::integer=version
      AND jsonb_typeof(task_inputs)='object' AND (source_run IS NULL OR source_run ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$' AND source_run<>run_id)
    );
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS zenithjoy.company_config_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES zenithjoy.tenant_company_profiles(company_id),
  version integer NOT NULL,
  actor text NOT NULL,
  source text NOT NULL,
  old_snapshot jsonb,
  new_snapshot jsonb,
  conflict jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 同步映射与实际读回状态属于运行台账，不能污染不可变业务版本。
CREATE TABLE IF NOT EXISTS zenithjoy.company_config_projections (
  company_id uuid NOT NULL,
  platform text NOT NULL CHECK(platform IN ('notion','feishu')),
  tenant_id uuid NOT NULL,
  mapping jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('unmapped','pending','verified','conflict','mismatch','failed')),
  verified_version integer,
  readback_evidence jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,platform),
  FOREIGN KEY(company_id,tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id,tenant_id)
);
-- 快照和历史禁止覆盖，避免后续版本修改历史运行证据。
CREATE OR REPLACE FUNCTION zenithjoy.reject_company_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'company configuration snapshot is immutable'; END $$;
DROP TRIGGER IF EXISTS immutable_company_version ON zenithjoy.company_config_versions;
CREATE TRIGGER immutable_company_version BEFORE UPDATE OR DELETE ON zenithjoy.company_config_versions FOR EACH ROW EXECUTE FUNCTION zenithjoy.reject_company_snapshot_mutation();
DROP TRIGGER IF EXISTS immutable_company_run ON zenithjoy.company_config_runs;
CREATE TRIGGER immutable_company_run BEFORE UPDATE OR DELETE ON zenithjoy.company_config_runs FOR EACH ROW EXECUTE FUNCTION zenithjoy.reject_company_snapshot_mutation();
ALTER TABLE IF EXISTS zenithjoy.leadgen_videos ADD COLUMN IF NOT EXISTS judgment_config jsonb;
ALTER TABLE IF EXISTS zenithjoy.leadgen_comments ADD COLUMN IF NOT EXISTS judgment_config jsonb;
