-- 双独立政策复核一致缺证据时，将评论终结为已排除；不产生评分或触达线索。
ALTER TABLE zenithjoy.leadgen_comments
  DROP CONSTRAINT IF EXISTS chk_leadgen_comments_status;
ALTER TABLE zenithjoy.leadgen_comments
  ADD CONSTRAINT chk_leadgen_comments_status
  CHECK (process_status IN ('待分拣', '已分拣', '已排除'));
ALTER TABLE zenithjoy.leadgen_comments
  ADD CONSTRAINT chk_leadgen_comments_excluded_unscored
  CHECK (process_status <> '已排除' OR (relevance IS NULL AND intent_grade IS NULL));
