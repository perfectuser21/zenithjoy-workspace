-- Migration: content-judgment-gate
-- Sprint: 07120952-line02-content-judgment-gate
-- Date: 2026-07-12
--
-- 新增字段：
--   zenithjoy.acquisition_collect_videos  → judgment_status, judgment_reason, capture_type
--   zenithjoy.acquisition_config          → target_profile_desc
--   zenithjoy.acquisition_leads           → outreach_eligible

-- §1: acquisition_collect_videos — 视频判决状态字段
ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS judgment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS judgment_reason text,
  ADD COLUMN IF NOT EXISTS capture_type text;

-- judgment_status 取值约束：pending | matched | rejected
-- pending  = 等待 Gemini 判决（超时或未判）
-- matched  = 内容与目标画像匹配，进入评论抓取
-- rejected = 内容与目标画像不符，跳过该视频
COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.judgment_status IS
  '内容判决状态: pending(待判) | matched(匹配) | rejected(不匹配)';
COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.judgment_reason IS
  'Gemini 给出的判决理由（rejected 时尤为重要）';
COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.capture_type IS
  '截图/录音采集类型: screenshot | audio | skipped_capture_failed';

-- §2: acquisition_config — 目标客户画像描述
ALTER TABLE zenithjoy.acquisition_config
  ADD COLUMN IF NOT EXISTS target_profile_desc text;

COMMENT ON COLUMN zenithjoy.acquisition_config.target_profile_desc IS
  '目标客户画像描述，供 Gemini 判断视频内容是否匹配。空字符串 = 所有视频直接 matched（INV-6）';

-- §3: acquisition_leads — 可触达标志
ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS outreach_eligible boolean;

COMMENT ON COLUMN zenithjoy.acquisition_leads.outreach_eligible IS
  '是否可触达：true=精准/高意向(可发 DM) | false=仅感兴趣或无评论(暂不发 DM)。由 rescoreLead 维护。';

-- 索引：buildAssignments 会按 outreach_eligible=true 过滤，加索引加速
CREATE INDEX IF NOT EXISTS idx_acquisition_leads_outreach_eligible
  ON zenithjoy.acquisition_leads (tenant_id, outreach_eligible)
  WHERE outreach_eligible = true;
