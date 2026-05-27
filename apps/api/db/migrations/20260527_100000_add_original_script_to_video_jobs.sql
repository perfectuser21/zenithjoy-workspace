-- WS1: add original_script + target_aspect + detected_aspect to ai_video_pipeline_jobs
ALTER TABLE zenithjoy.ai_video_pipeline_jobs
  ADD COLUMN IF NOT EXISTS original_script  TEXT NULL,
  ADD COLUMN IF NOT EXISTS target_aspect    TEXT CHECK (target_aspect IN ('9:16', '16:9')) NULL,
  ADD COLUMN IF NOT EXISTS detected_aspect  TEXT CHECK (detected_aspect IN ('9:16', '16:9')) NULL;
