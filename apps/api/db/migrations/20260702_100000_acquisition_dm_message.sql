-- apps/api/db/migrations/20260702_100000_acquisition_dm_message.sql
-- Line02 Stage 3: acquisition_config 加 dm_message 列（私信话术，每租户可配）
--   + dispatchDue 真派单所需：dm_assignments 加 agent_id 列

ALTER TABLE zenithjoy.acquisition_config
  ADD COLUMN IF NOT EXISTS dm_message text NOT NULL DEFAULT '您好，看到您的评论，我们正在做相关品牌，有合作意向欢迎联系企微😊';

ALTER TABLE zenithjoy.dm_assignments
  ADD COLUMN IF NOT EXISTS agent_id text;
