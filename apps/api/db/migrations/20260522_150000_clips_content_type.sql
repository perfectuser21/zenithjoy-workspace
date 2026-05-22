-- Add content_type and text fields to clips for image vs video detection
ALTER TABLE zenithjoy.clips
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS text TEXT;
