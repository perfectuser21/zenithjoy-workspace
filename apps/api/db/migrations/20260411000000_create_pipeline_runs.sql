-- Create pipeline_runs table for zenithjoy to own content pipeline records
--
-- This migration is idempotent - can be run multiple times safely

CREATE TABLE IF NOT EXISTS zenithjoy.pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cecelia_task_id VARCHAR(100),
  content_type    VARCHAR(50) NOT NULL,
  topic           TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  output_dir      TEXT,
  output_manifest JSONB,
  triggered_by    VARCHAR(50) DEFAULT 'manual',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON zenithjoy.pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON zenithjoy.pipeline_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_cecelia_task_id ON zenithjoy.pipeline_runs(cecelia_task_id);

-- Create updated_at trigger (reuse existing function if available)
DROP TRIGGER IF EXISTS update_pipeline_runs_updated_at ON zenithjoy.pipeline_runs;

CREATE TRIGGER update_pipeline_runs_updated_at
  BEFORE UPDATE ON zenithjoy.pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION zenithjoy.update_updated_at_column();

COMMENT ON TABLE zenithjoy.pipeline_runs IS 'ZenithJoy owned content pipeline run records, linked to Cecelia task execution';
