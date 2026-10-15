-- 新安卓事件提供source_event_id；旧客户端NULL保持兼容。
ALTER TABLE zenithjoy.wechat_messages ADD COLUMN IF NOT EXISTS source_event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wechat_message_source_event
  ON zenithjoy.wechat_messages(contact_key, direction, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wechat_crm_pending
  ON zenithjoy.wechat_messages(contact_key, created_at)
  WHERE consolidated = FALSE AND status = 'delivered';
