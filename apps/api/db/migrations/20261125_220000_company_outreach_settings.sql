CREATE TABLE IF NOT EXISTS zenithjoy.company_outreach_settings (
  company_id uuid NOT NULL,
  tenant_id uuid PRIMARY KEY,
  daily_cap integer NOT NULL CHECK (daily_cap BETWEEN 1 AND 1000),
  start_local time(0) NOT NULL CHECK (start_local < TIME '24:00' AND EXTRACT(second FROM start_local) = 0),
  end_local time(0) NOT NULL CHECK (end_local < TIME '24:00' AND EXTRACT(second FROM end_local) = 0),
  paused boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, tenant_id)
    REFERENCES zenithjoy.tenant_company_profiles(company_id, tenant_id) ON DELETE CASCADE
);
