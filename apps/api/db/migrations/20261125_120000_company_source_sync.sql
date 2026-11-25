CREATE TABLE IF NOT EXISTS zenithjoy.company_source_sync (
  company_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('notion', 'feishu')),
  parent_id text NOT NULL,
  draft jsonb,
  draft_id uuid,
  base_version integer,
  applied_version integer,
  fetched_at timestamptz,
  applied_at timestamptz,
  FOREIGN KEY (company_id, tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id, tenant_id),
  UNIQUE (platform, parent_id)
);
