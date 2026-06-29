-- Line04 客服工作汇总 stats — 给短期消息盖「客服微信号」身份章
--
-- 背景：对话原文已落 zenithjoy.cs_memory_messages（短期滑窗），但缺「哪台客服处理的」
-- 身份字段，无法按客服聚合工作量。本 migration 加 nullable cs_wechat_id 列 + 聚合索引。
--
-- 可空纪律：老数据 / 身份解析失败 → cs_wechat_id 为 NULL，stats 聚合一律不计入任何客服、
-- 接口不报错（向后兼容，不回填历史）。索引 (cs_wechat_id, created_at) 加速「按客服 + 日界」聚合。
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS（E2E smoke 可重入）。

ALTER TABLE zenithjoy.cs_memory_messages
  ADD COLUMN IF NOT EXISTS cs_wechat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cs_memory_messages_cswx_created_at
  ON zenithjoy.cs_memory_messages (cs_wechat_id, created_at);

COMMENT ON COLUMN zenithjoy.cs_memory_messages.cs_wechat_id IS
  '处理该条消息的客服微信号身份章（经 agent_id→machine→service_agents→wechat_id 解析）；NULL=老数据/解析失败，stats 聚合不计入任何客服';
