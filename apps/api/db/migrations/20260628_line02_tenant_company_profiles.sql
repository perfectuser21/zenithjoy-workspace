-- Line02 公司信息页 — tenant_company_profiles 表
CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE TABLE IF NOT EXISTS zenithjoy.tenant_company_profiles (
  tenant_id          uuid PRIMARY KEY REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  company_name       text NOT NULL DEFAULT '',
  city               text NOT NULL DEFAULT '',
  industry           text NOT NULL DEFAULT '',
  description        text NOT NULL DEFAULT '',
  products           jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_advantages     jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_problem   text NOT NULL DEFAULT '',
  customer_portrait  text NOT NULL DEFAULT '',
  qa_list            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zenithjoy.tenant_company_profiles IS
  'Line02 公司信息 — 租户公司基础信息、产品卖点、客户画像';
