-- Create ai_video_generations table for storing video generation history
--
-- This migration is idempotent - can be run multiple times safely

-- Create table if not exists
CREATE TABLE IF NOT EXISTS zenithjoy.ai_video_generations (
  id VARCHAR(255) PRIMARY KEY,
  platform VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('queued', 'in_progress', 'completed', 'failed')),
  progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  video_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Generation parameters
  duration INT,
  aspect_ratio VARCHAR(20),
  resolution VARCHAR(20)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_video_generations_status ON zenithjoy.ai_video_generations(status);
CREATE INDEX IF NOT EXISTS idx_ai_video_generations_created_at ON zenithjoy.ai_video_generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_video_generations_platform ON zenithjoy.ai_video_generations(platform);

-- Create updated_at trigger function (if not exists)
CREATE OR REPLACE FUNCTION zenithjoy.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop trigger if exists (to recreate with same settings)
DROP TRIGGER IF EXISTS update_ai_video_generations_updated_at ON zenithjoy.ai_video_generations;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_ai_video_generations_updated_at
  BEFORE UPDATE ON zenithjoy.ai_video_generations
  FOR EACH ROW
  EXECUTE FUNCTION zenithjoy.update_updated_at_column();

-- Add comment
COMMENT ON TABLE zenithjoy.ai_video_generations IS 'Stores AI video generation task history and status';
