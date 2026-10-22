-- 101页面指标独立于102实际采集comment_count；未知为null，原件与来源绑定随观测保存。
ALTER TABLE zenithjoy.leadgen_videos ADD COLUMN IF NOT EXISTS discovery_metrics jsonb;
COMMENT ON COLUMN zenithjoy.leadgen_videos.discovery_metrics IS
  '101最新同视频页面观测：原文/数值/评论分档、run/attempt/固定SHA、原生树及digest；不替代102实采comment_count';
