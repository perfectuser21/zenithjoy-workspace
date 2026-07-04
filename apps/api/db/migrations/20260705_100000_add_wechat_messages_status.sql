-- Line04 假账根治①：wechat_messages 加 status（draft→delivered/failed）
-- 默认 delivered：存量行与 in 行语义不变；新写 out 行由代码显式 status='draft'，
-- 真送达回执(POST /api/wechat/messages/:id/receipt)置 delivered/failed。
ALTER TABLE zenithjoy.wechat_messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'delivered'
  CHECK (status IN ('draft','delivered','failed'));

CREATE INDEX IF NOT EXISTS idx_wechat_messages_status
  ON zenithjoy.wechat_messages(status) WHERE status <> 'delivered';

COMMENT ON COLUMN zenithjoy.wechat_messages.status IS
  'out 行台账状态：draft=AI已生成未确认送达 / delivered=真机读回确认送达 / failed=发送终态失败。in 行恒 delivered。';
