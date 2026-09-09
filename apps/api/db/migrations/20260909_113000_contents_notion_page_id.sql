-- contents 加 notion_page_id：Notion 发布编排台推送锚（NULL=尚未推送）。
-- 全部 DDL 幂等（CI glob runner 全量重放）；不包 BEGIN/COMMIT（run-migration.ts 外层有事务）。

ALTER TABLE zenithjoy.contents ADD COLUMN IF NOT EXISTS notion_page_id TEXT;

-- 推送方向查询走这个部分索引：WHERE tenant_id=$1 AND notion_page_id IS NULL AND status='draft'
CREATE INDEX IF NOT EXISTS idx_contents_notion_pending
  ON zenithjoy.contents (tenant_id)
  WHERE notion_page_id IS NULL;

COMMENT ON COLUMN zenithjoy.contents.notion_page_id IS 'Notion 发布编排台行(page) id；NULL=尚未推送到 Notion';
