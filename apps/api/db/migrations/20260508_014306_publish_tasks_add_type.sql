-- 加 type 字段到 publish_tasks（修复 P0 bug 根因：表无法承载"同平台多类型"）
-- WS2 Sprint 2.1a Workstream 1
-- 默认值 'image' backfill 历史数据（之前所有任务实际都是 image dryrun）

ALTER TABLE zenithjoy.publish_tasks
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'image'
    CHECK (type IN ('video', 'image', 'article'));

CREATE INDEX IF NOT EXISTS idx_publish_tasks_platform_type
  ON zenithjoy.publish_tasks (platform, type);

COMMENT ON COLUMN zenithjoy.publish_tasks.type IS
  'publish 类型: video=短视频 / image=图文 / article=长文。Agent 按 type 路由 publisher 脚本。';
