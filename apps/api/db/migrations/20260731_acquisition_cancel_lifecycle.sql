ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_command_id uuid,
  ADD COLUMN IF NOT EXISTS device_machine_id text;

ALTER TABLE zenithjoy.acquisition_collect_tasks
  DROP CONSTRAINT IF EXISTS chk_acq_collect_status;
ALTER TABLE zenithjoy.acquisition_collect_tasks
  DROP CONSTRAINT IF EXISTS acquisition_collect_tasks_status_check;
ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD CONSTRAINT acquisition_collect_tasks_status_check CHECK (
    status IN ('pending','running','cancelling','cancelled','done','stage_1_done','partial','failed')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_acquisition_cancel_command
  ON zenithjoy.acquisition_collect_tasks(cancel_command_id)
  WHERE cancel_command_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acquisition_cancel_cooldown
  ON zenithjoy.acquisition_collect_tasks(tenant_id, device_machine_id, cancelled_at)
  WHERE status = 'cancelled';
