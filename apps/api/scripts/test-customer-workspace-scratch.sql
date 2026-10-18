\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'cecelia_scratch' THEN RAISE EXCEPTION 'scratch database required'; END IF;
END $$;
BEGIN;
\ir ../db/migrations/20261018_120000_customer_workspace_bindings.sql
DO $$
DECLARE
  tenant_a uuid := gen_random_uuid(); tenant_b uuid := gen_random_uuid();
  company_a uuid := gen_random_uuid(); company_b uuid := gen_random_uuid();
  parent_a text := 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
BEGIN
  INSERT INTO zenithjoy.tenants(id,name,license_key) VALUES (tenant_a,'开户合同验收甲',gen_random_uuid()::text),(tenant_b,'开户合同验收乙',gen_random_uuid()::text);
  INSERT INTO zenithjoy.tenant_company_profiles(tenant_id,company_id,company_name) VALUES (tenant_a,company_a,'开户合同验收甲'),(tenant_b,company_b,'开户合同验收乙');
  INSERT INTO zenithjoy.customer_workspaces(company_id,tenant_id,platform,parent_id,template_version,state)
  VALUES(company_a,tenant_a,'notion',parent_a,1,jsonb_build_object('company_id',company_a,'tenant_id',tenant_a,'platform','notion','parent_id',parent_a));
  BEGIN
    INSERT INTO zenithjoy.customer_workspaces(company_id,tenant_id,platform,parent_id,template_version,state)
    VALUES(company_b,tenant_b,'notion','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',1,jsonb_build_object('company_id',company_b,'tenant_id',tenant_b,'platform','notion','parent_id','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'));
    RAISE EXCEPTION 'canonical parent uniqueness did not fire';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO zenithjoy.customer_workspaces(company_id,tenant_id,platform,parent_id,template_version,state)
    VALUES(company_b,tenant_a,'feishu','base-other',1,jsonb_build_object('company_id',company_b,'tenant_id',tenant_a,'platform','feishu','parent_id','base-other'));
    RAISE EXCEPTION 'company/tenant foreign key did not fire';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: canonical parent uniqueness and company/tenant FK';
END $$;
ROLLBACK;
