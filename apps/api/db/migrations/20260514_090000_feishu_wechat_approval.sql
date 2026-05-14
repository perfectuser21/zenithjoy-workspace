-- apps/api/db/migrations/20260514_090000_feishu_wechat_approval.sql
-- Path 4 Sprint 1 WS2: 飞书 Bitable 审批表支持
ALTER TABLE zenithjoy.tenant_feishu_bindings
  ADD COLUMN IF NOT EXISTS table_id_wechat_approval text;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS feishu_record_id text;

COMMENT ON COLUMN zenithjoy.tenant_feishu_bindings.table_id_wechat_approval IS
  'Path 4 WS2 — 飞书「微信发布审批」多维表格 table_id';

COMMENT ON COLUMN zenithjoy.wechat_publish_task.feishu_record_id IS
  'Path 4 WS2 — 对应飞书 Bitable 行 ID，WS5 反向同步用';
