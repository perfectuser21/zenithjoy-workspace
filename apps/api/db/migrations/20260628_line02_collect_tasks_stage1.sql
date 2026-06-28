-- Line02 采集任务表扩展：添加 ended_at 字段 + stage_1_done 状态
ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- 扩展 status CHECK 约束以支持 stage_1_done
ALTER TABLE zenithjoy.acquisition_collect_tasks
  DROP CONSTRAINT IF EXISTS chk_acq_collect_status;

ALTER TABLE zenithjoy.acquisition_collect_tasks
  ADD CONSTRAINT chk_acq_collect_status CHECK (
    status IN ('pending', 'running', 'cancelling', 'cancelled', 'done', 'stage_1_done', 'partial', 'failed')
  );
