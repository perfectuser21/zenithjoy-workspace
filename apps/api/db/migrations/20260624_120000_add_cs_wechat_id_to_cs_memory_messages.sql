-- Line04 客服工作汇总统计 — 给短期对话表盖「哪台客服机处理的」身份章
--
-- 背景：对话原文已逐条落 zenithjoy.cs_memory_messages（in/out），但缺「哪台客服处理的」
-- 身份字段 → 无法按客服微信号聚合统计（Issue ecf13d74）。本迁移加 nullable cs_wechat_id
-- 身份章列 + (cs_wechat_id, created_at) 复合索引（统计按客服 × 时间窗聚合走它）。
--
-- 向后兼容纪律：列 nullable、不回填历史（老数据 cs_wechat_id 保持 NULL；统计侧 NULL 不计入、
-- 不串台、不报错）。全部 IF NOT EXISTS（幂等，E2E smoke 可重入）。schema 前缀 zenithjoy。

ALTER TABLE zenithjoy.cs_memory_messages
  ADD COLUMN IF NOT EXISTS cs_wechat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cs_memory_messages_cs_wechat_id_time
  ON zenithjoy.cs_memory_messages (cs_wechat_id, created_at);
