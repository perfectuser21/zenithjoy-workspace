-- Step 6 Dispatch Chain: add publish_status to works table
-- ws1: publish_status TEXT CHECK constraint with queued/success/failed

ALTER TABLE zenithjoy.works
  ADD COLUMN IF NOT EXISTS publish_status TEXT
    CHECK (publish_status IN ('queued', 'success', 'failed'));

CREATE INDEX IF NOT EXISTS idx_works_publish_status
  ON zenithjoy.works (publish_status)
  WHERE publish_status IS NOT NULL;
