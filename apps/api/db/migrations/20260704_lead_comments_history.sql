-- Migration: lead_comments_history
-- Sprint: 0704114440-line02-lead-scoring-redesign
-- Purpose: 一人可有多条评论历史（之前 dedup 命中同一人时会丢弃后续评论内容），
--          + acquisition_leads 加汇总字段供派发优先级公式使用（频次+时效）

CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_lead_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES zenithjoy.acquisition_leads(id) ON DELETE CASCADE,
  video_id      text,
  comment_text  text,
  grade         text,
  commented_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acq_lead_comments_lead ON zenithjoy.acquisition_lead_comments(lead_id);
CREATE INDEX IF NOT EXISTS idx_acq_lead_comments_commented_at ON zenithjoy.acquisition_lead_comments(lead_id, commented_at DESC);

ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0;

ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS last_commented_at timestamptz;

-- 回填：把每个 lead 现有的单条 comment_text/grade 补进历史表（不丢历史数据），
-- comment_count=1（回填前只存了一条），last_commented_at=created_at
INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, video_id, comment_text, grade, commented_at)
SELECT id, NULL, comment_text, grade, created_at
  FROM zenithjoy.acquisition_leads
 WHERE comment_text IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM zenithjoy.acquisition_lead_comments c WHERE c.lead_id = zenithjoy.acquisition_leads.id
   );

UPDATE zenithjoy.acquisition_leads
   SET comment_count = 1, last_commented_at = created_at
 WHERE comment_text IS NOT NULL AND comment_count = 0;
