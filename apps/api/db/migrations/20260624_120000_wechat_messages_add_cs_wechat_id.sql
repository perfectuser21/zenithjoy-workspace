-- Line04 客服工作汇总统计（S3）— 给消息盖「哪台客服处理的」身份章
--
-- 在真实回复链路落库表 zenithjoy.wechat_messages（contact-memory.ts appendMessage 写的就是它）
-- 加 cs_wechat_id：记录处理该消息的客服微信号，供「客服工作汇总」按每客服聚合统计。
--
-- 向后兼容铁律（用户已拍板）：
--   - 字段 nullable：老数据 / 身份解析失败 → NULL，不计入统计、接口不报错。
--   - 不回填历史：回填要猜归属易错，只对新消息盖章。
--
-- 加索引 (cs_wechat_id, created_at) 加速「按客服 + 当天时间窗」聚合。
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS（E2E smoke 可重入）。

ALTER TABLE zenithjoy.wechat_messages
  ADD COLUMN IF NOT EXISTS cs_wechat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wechat_messages_cs_wechat_id_time
  ON zenithjoy.wechat_messages (cs_wechat_id, created_at);

COMMENT ON COLUMN zenithjoy.wechat_messages.cs_wechat_id
  IS '处理该消息的客服微信号（落库时由 agent_id 经身份链解析盖章）；nullable，NULL=老数据/解析失败，不计入统计';
