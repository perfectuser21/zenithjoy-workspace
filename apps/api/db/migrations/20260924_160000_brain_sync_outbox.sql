-- Brain 同步补投队列。
--
-- 为什么要：桥接往 Brain 写是 best-effort（记账是附属，采收是正事，绝不能阻断）。
-- 但直接丢掉会造成系统性偏差 —— 跨境网络坏的那晚正是最需要看见的晚上，却恰恰
-- 一条记录都没有，页面从"0 任务"变成"只显示好天气的任务"，比现在更骗人。
CREATE TABLE IF NOT EXISTS zenithjoy.brain_sync_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_task_id uuid NOT NULL,
  op           text NOT NULL CHECK (op IN ('create', 'complete', 'sweep')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_sync_outbox_pending
  ON zenithjoy.brain_sync_outbox (created_at) WHERE attempts < 10;
