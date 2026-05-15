-- Add video pipeline columns to ai_video_generations
-- Supports local Whisper+FFmpeg processing (platform=local-whisper-ffmpeg)

ALTER TABLE zenithjoy.ai_video_generations
  ADD COLUMN IF NOT EXISTS source_video_path TEXT,
  ADD COLUMN IF NOT EXISTS script_text       TEXT,
  ADD COLUMN IF NOT EXISTS logo_path         TEXT,
  ADD COLUMN IF NOT EXISTS output_9_16_url   TEXT,
  ADD COLUMN IF NOT EXISTS output_16_9_url   TEXT;
