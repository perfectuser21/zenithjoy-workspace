CREATE TABLE IF NOT EXISTS zenithjoy.notion_company_source_requests (
  page_id text PRIMARY KEY CHECK (page_id ~ '^[0-9a-f]{32}$'),
  company_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  actor text NOT NULL,
  success boolean NOT NULL,
  version integer,
  receipt text NOT NULL,
  FOREIGN KEY (company_id, tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id, tenant_id)
);
