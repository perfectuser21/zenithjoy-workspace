-- Path 2 Sprint B-1 WS3 支撑：publish_tasks 加 burner 路由必需字段
--
-- 现有 schema (walking_skeleton_1)：(id, agent_id, platform, status, folder_path, result, receipt_at, created_at, type)
-- ws3 burner 路由需要：task_type, payload(JSONB), response(JSONB), tenant_id, updated_at + status='done'
--
-- 兼容策略：
--   - task_type TEXT NULL — 走 burner 路由的 task 用 'qr_bind/douyin_burner' / 'crawl_comments/douyin'，老 task NULL（用 platform 字段路由）
--   - payload JSONB NULL — 老 task 没用，新 task 存 {agent_id, account_label, video_url, tenant_id}
--   - response JSONB NULL — 老 task 用 result；新 task 用 response 区分上报数据
--   - tenant_id UUID NULL — 老 task 不带（老 schema 完全靠 agent_id 反查）
--   - updated_at TIMESTAMPTZ DEFAULT now() — 老 task 没维护更新时间
--   - status CHECK 加 'done' — 老 'success' 兼容保留，新 burner 上报用 'done'

ALTER TABLE zenithjoy.publish_tasks
  ADD COLUMN IF NOT EXISTS task_type   TEXT,
  ADD COLUMN IF NOT EXISTS payload     JSONB,
  ADD COLUMN IF NOT EXISTS response    JSONB,
  ADD COLUMN IF NOT EXISTS tenant_id   UUID,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- 重建 status CHECK 约束加 'done'（旧 success/failed/pending/running 保留）
ALTER TABLE zenithjoy.publish_tasks
  DROP CONSTRAINT IF EXISTS chk_publish_tasks_status;
ALTER TABLE zenithjoy.publish_tasks
  ADD CONSTRAINT chk_publish_tasks_status
  CHECK (status IN ('pending', 'running', 'success', 'failed', 'done'));

CREATE INDEX IF NOT EXISTS idx_publish_tasks_task_type
  ON zenithjoy.publish_tasks(task_type) WHERE task_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_publish_tasks_payload_agent
  ON zenithjoy.publish_tasks USING GIN (payload);

COMMENT ON COLUMN zenithjoy.publish_tasks.task_type IS
  'Path 2 Sprint B-1：burner 路由 task 用，例 qr_bind/douyin_burner / crawl_comments/douyin。老 task 走 platform 字段，task_type=NULL';
COMMENT ON COLUMN zenithjoy.publish_tasks.payload IS
  'Path 2 Sprint B-1：burner 路由 task 入参，例 {agent_id, account_label, video_url, tenant_id}';
COMMENT ON COLUMN zenithjoy.publish_tasks.response IS
  'Path 2 Sprint B-1：burner 路由 task 上报数据，例 {phase, cookie_local_path, comment_count, lead_write_status}';
