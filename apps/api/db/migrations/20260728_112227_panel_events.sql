-- 作战窗 Agent Panel 刀1 — panel_events 表（薄写入端点，events表+events端点）
-- PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md
--
-- 与 line04 现有的本地 events.jsonl（画像卡用，单写者=listen_chat.py）完全独立——
-- 这张表是中台落库副本，供刀2 dashboard 聚合展示，不是本地实时通道本身。
--
-- 6种事件：task_started/step/waiting/stuck/done/failed
-- 按 tenant_id 隔离（系统级不变量，decisions表"[系统]租户隔离"）。
-- 纯 CREATE IF NOT EXISTS，幂等可重入，不动既有表。
CREATE TABLE IF NOT EXISTS zenithjoy.panel_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text NOT NULL,
  task_id    text NOT NULL,
  event      text NOT NULL CHECK (event IN ('task_started', 'step', 'waiting', 'stuck', 'done', 'failed')),
  line       text NOT NULL,
  device     text NOT NULL,
  title      text NOT NULL,
  detail     text,
  progress   jsonb,
  severity   text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_panel_events_tenant_created
  ON zenithjoy.panel_events (tenant_id, created_at DESC);

COMMENT ON TABLE zenithjoy.panel_events IS
  '作战窗 Agent Panel 事件留痕（薄写入端点写入，刀2 dashboard 聚合读）。刀1只接line04一条真实线。';
