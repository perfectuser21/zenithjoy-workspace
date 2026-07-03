-- 为 acquisition_keyword_tasks 加 tenant_id，实现跨租户任务隔离
ALTER TABLE zenithjoy.acquisition_keyword_tasks
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE;

-- 加索引：按 tenant + status 查询（pending-keyword-tasks 轮询路径）
CREATE INDEX IF NOT EXISTS idx_acq_kw_tasks_tenant_status
  ON zenithjoy.acquisition_keyword_tasks (tenant_id, status)
  WHERE status = 'dispatched';
