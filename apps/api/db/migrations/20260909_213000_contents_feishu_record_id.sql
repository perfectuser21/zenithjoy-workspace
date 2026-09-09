-- contents 加 feishu_record_id：飞书发布编排台行(record)锚（NULL=尚未推送）。
-- 全部 DDL 幂等（CI glob runner 全量重放）；不包 BEGIN/COMMIT（run-migration.ts 外层有事务）。

ALTER TABLE zenithjoy.contents ADD COLUMN IF NOT EXISTS feishu_record_id TEXT;

-- 推送方向查询走这个部分索引：WHERE tenant_id=$1 AND feishu_record_id IS NULL AND status='draft'
CREATE INDEX IF NOT EXISTS idx_contents_feishu_pending
  ON zenithjoy.contents (tenant_id)
  WHERE feishu_record_id IS NULL;

COMMENT ON COLUMN zenithjoy.contents.feishu_record_id IS
  '飞书发布编排台行(record) id；NULL=尚未推送到飞书。与 Line04 的 wechat_publish_task.feishu_record_id 无关（不同表、不同业务：那是微信客服审批表行锚，这是内容发布编排台行锚）';
