ALTER TABLE zenithjoy.ai_video_pipeline_jobs
  ADD COLUMN IF NOT EXISTS license_id uuid REFERENCES zenithjoy.licenses(id);

CREATE INDEX IF NOT EXISTS idx_video_pipeline_jobs_license_id
  ON zenithjoy.ai_video_pipeline_jobs(license_id)
  WHERE license_id IS NOT NULL;
