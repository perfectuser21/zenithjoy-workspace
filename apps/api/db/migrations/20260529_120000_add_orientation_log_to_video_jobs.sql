-- Add Step 1.5 vision orientation detection result columns to ai_video_pipeline_jobs
-- Allows remote diagnosis of why a video was/wasn't rotated

ALTER TABLE zenithjoy.ai_video_pipeline_jobs
  ADD COLUMN IF NOT EXISTS step15_orientation  text,
  ADD COLUMN IF NOT EXISTS step15_confidence   numeric(4,3),
  ADD COLUMN IF NOT EXISTS step15_reasoning    text;
