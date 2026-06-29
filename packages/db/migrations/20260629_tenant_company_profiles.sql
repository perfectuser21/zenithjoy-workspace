-- Migration: create zenithjoy.tenant_company_profiles + backfill acquisition_collect_tasks.ended_at
-- Required by: /api/company-profile GET/PUT + GET /api/acquisition/collect/:task_id (Line02 智能获客)

-- acquisition_collect_tasks 补 ended_at（旧表建时未含此列）
ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS zenithjoy.tenant_company_profiles (
  id                SERIAL        PRIMARY KEY,
  tenant_id         UUID          NOT NULL UNIQUE,
  company_name      TEXT          NOT NULL DEFAULT '',
  city              TEXT          NOT NULL DEFAULT '',
  industry          TEXT          NOT NULL DEFAULT '',
  description       TEXT          NOT NULL DEFAULT '',
  products          JSONB         NOT NULL DEFAULT '[]',
  key_advantages    JSONB         NOT NULL DEFAULT '[]',
  customer_problem  TEXT          NOT NULL DEFAULT '',
  customer_portrait TEXT          NOT NULL DEFAULT '',
  qa_list           JSONB         NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
