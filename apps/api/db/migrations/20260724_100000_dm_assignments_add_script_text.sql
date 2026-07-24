-- GP-2：dm_assignments 加 script_text 列（人工触达话术）
ALTER TABLE zenithjoy.dm_assignments
  ADD COLUMN IF NOT EXISTS script_text text;

COMMENT ON COLUMN zenithjoy.dm_assignments.script_text IS
  'GP-2 人工触达话术：POST /outreach/manual 写入，agent 执行时使用';
