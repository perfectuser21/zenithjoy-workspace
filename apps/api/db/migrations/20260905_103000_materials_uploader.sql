-- materials 加上传者：现在只记 tenant_id（租户），同一客户公司下多名员工各自配了
-- iOS 快捷指令上传时，后端分不清素材来自谁。现在加列远比以后回填便宜。
--
-- 语义：租户隔离仍然以 tenant_id 为准——这一列只用于区分同租户内的来源，
-- 不承担任何安全职责。
--
-- 可空：老数据没有这个信息，不编造。
--
-- 全部 DDL 幂等：CI 重放全部 migration。
-- 不包 BEGIN/COMMIT：run-migration.ts 已把整份文件包在外层事务里。

ALTER TABLE zenithjoy.materials
  ADD COLUMN IF NOT EXISTS uploaded_by_license_id UUID;

CREATE INDEX IF NOT EXISTS materials_uploader_idx
  ON zenithjoy.materials (tenant_id, uploaded_by_license_id, created_at DESC);

COMMENT ON COLUMN zenithjoy.materials.uploaded_by_license_id IS
  '哪张 license 传的。可空：老数据无此信息。租户隔离仍以 tenant_id 为准，本列只用于区分同租户内的来源。';
