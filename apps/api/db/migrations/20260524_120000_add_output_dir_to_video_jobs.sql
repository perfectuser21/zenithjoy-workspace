-- 补加 output_dir 列到 ai_video_pipeline_jobs（local-first 架构：Agent 写本地路径）
ALTER TABLE zenithjoy.ai_video_pipeline_jobs
  ADD COLUMN IF NOT EXISTS output_dir TEXT;
