-- 只登记客户工作台与外部资源映射；业务、任务、运行仍引用原真身。
CREATE TABLE IF NOT EXISTS zenithjoy.customer_workspaces (
  company_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  platform text NOT NULL CHECK(platform IN ('notion','feishu')),
  parent_id text NOT NULL CHECK(length(parent_id) BETWEEN 1 AND 128),
  template_version integer NOT NULL CHECK(template_version > 0),
  modules jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(modules)='array'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','provisioning','structure_ready','needs_reconciliation')),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,platform),
  UNIQUE(platform,parent_id),
  FOREIGN KEY(company_id,tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id,tenant_id),
  CHECK(jsonb_typeof(state)='object' AND state ?& ARRAY['company_id','tenant_id','platform','parent_id'] AND state->>'company_id'=company_id::text AND state->>'tenant_id'=tenant_id::text AND state->>'platform'=platform AND state->>'parent_id'=parent_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_workspace_canonical_parent ON zenithjoy.customer_workspaces(platform, (CASE WHEN platform='notion' THEN lower(replace(parent_id,'-','')) ELSE parent_id END));
CREATE TABLE IF NOT EXISTS zenithjoy.customer_workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  platform text NOT NULL,
  actor text NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,platform) REFERENCES zenithjoy.customer_workspaces(company_id,platform),
  FOREIGN KEY(company_id,tenant_id) REFERENCES zenithjoy.tenant_company_profiles(company_id,tenant_id)
);
