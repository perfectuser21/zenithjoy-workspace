-- Migration: acquisition_leads 补充评论详情字段，摆脱飞书依赖
-- 加这三列后 GET /leads 可直接从本地 DB 读，无需飞书 token

ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS comment_text TEXT,
  ADD COLUMN IF NOT EXISTS grade        TEXT,
  ADD COLUMN IF NOT EXISTS keyword      TEXT;

COMMENT ON COLUMN zenithjoy.acquisition_leads.comment_text IS '评论正文（从 collect/report payload 落库，Path2 新流程）';
COMMENT ON COLUMN zenithjoy.acquisition_leads.grade        IS '评级 A/B/C/D（DeepSeek gradeComment 结果）';
COMMENT ON COLUMN zenithjoy.acquisition_leads.keyword      IS '触发该 lead 的关键词';
