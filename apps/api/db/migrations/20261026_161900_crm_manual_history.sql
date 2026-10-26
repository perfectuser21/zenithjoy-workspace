-- Manual materials are not WeChat inbound/delivered events. No automatic reply side effects.
CREATE TABLE IF NOT EXISTS zenithjoy.crm_manual_history_previews (
 id uuid PRIMARY KEY,
 version uuid NOT NULL,
 tenant_id uuid NOT NULL,
 cs_wechat_id text NOT NULL,
 customer_id bigint NOT NULL REFERENCES zenithjoy.crm_customers(id),
 created_by text NOT NULL,
 source_type text NOT NULL CHECK(source_type IN ('individual','group')),
 channel_name text NOT NULL,
 source_account text,
 raw_text text NOT NULL,
 material_hash text NOT NULL,
 analysis jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_manual_history_preview_lookup ON zenithjoy.crm_manual_history_previews
 (tenant_id,cs_wechat_id,customer_id,created_by,material_hash,expires_at);
CREATE TABLE IF NOT EXISTS zenithjoy.crm_manual_history_imports (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 cs_wechat_id text NOT NULL,
 customer_id bigint NOT NULL REFERENCES zenithjoy.crm_customers(id),
 created_by text NOT NULL,
 source text NOT NULL DEFAULT 'manual_import' CHECK(source='manual_import'),
 source_type text NOT NULL CHECK(source_type IN ('individual','group')),
 channel_name text NOT NULL,
 source_account text,
 raw_text text NOT NULL,
 material_hash text NOT NULL,
 analysis jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,cs_wechat_id,customer_id,material_hash)
);
CREATE INDEX IF NOT EXISTS crm_manual_history_import_customer ON zenithjoy.crm_manual_history_imports
 (tenant_id,cs_wechat_id,customer_id,created_at);
CREATE TABLE IF NOT EXISTS zenithjoy.crm_manual_history_requests (
 tenant_id uuid NOT NULL,
 created_by text NOT NULL,
 request_id uuid NOT NULL,
 cs_wechat_id text NOT NULL,
 customer_id bigint NOT NULL REFERENCES zenithjoy.crm_customers(id),
 preview_id uuid NOT NULL,
 preview_version uuid NOT NULL,
 fingerprint text NOT NULL,
 import_id uuid NOT NULL REFERENCES zenithjoy.crm_manual_history_imports(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,created_by,request_id)
);
-- Rollback (only before accepting data): drop requests, imports, then previews.
-- After real imports exist retain these tables; rolling back application code must not delete history.
