-- 批量混剪 S1（GP f6f96e17）：素材打标签落库字段。
--
-- tag_status 三态对齐提案 FR：'pending'（待处理，默认）/ 'tagged'（已识别）/
-- 'failed_pending_review'（处理失败/人工复核中）——客户在素材库页面看到的就是这三态。
--
-- ai_tags 用 jsonb 数组存标签列表，ai_description 存 Gemini 给的一句话内容描述，
-- 两者都允许为空（tag_status='pending' 时本来就还没有值）。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.materials
  ADD COLUMN IF NOT EXISTS tag_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_tags JSONB,
  ADD COLUMN IF NOT EXISTS ai_description TEXT,
  ADD COLUMN IF NOT EXISTS tagged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS materials_tag_status_idx
  ON zenithjoy.materials (tenant_id, tag_status);
