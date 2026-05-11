-- H-1 ws2 — publish_tasks status enum 完整 superset
--
-- 修 PRD Bug 2: B-1 generator 用 'queued' 撞 chk_publish_tasks_status，临时 SQL DROP 留 dirty state
-- 现在统一 enum：5 老 + 4 新 = 9 个
--
-- Status 语义 + canonical 时间表（H-1 起）：
--
--   pending     — 任务刚 INSERT 还没派 (canonical)
--   queued      — 任务进派发队列等待 agent (canonical, H-1 新)
--   dispatched  — 已发 WS 消息给 agent，等 agent ack (canonical, H-1 新)
--   in_progress — agent 执行中 (canonical, H-1 新)
--   running     — agent 执行中 (deprecated since H-1, sweep in H-3, 兼容期保留)
--   completed   — 成功完成 (canonical, H-1 新)
--   success     — 成功完成 (deprecated since H-1, sweep in H-3, 兼容期保留)
--   done        — 成功完成 (deprecated since H-1, sweep in H-3, 兼容期保留)
--   failed      — 失败 (canonical)
--
-- 兼容性：本 sprint 不动 INSERT 处代码 — 既有 'success/done/running' 仍可写。
-- H-3 sprint 全代码 sweep 改 canonical 后，下一次 enum migration 删 deprecated 5 个值。
--
-- 幂等：DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT chk_publish_tasks_status — 重跑安全
-- 顺序：filename 20260511_102431_* > 20260510_0c10fd_* 保 run-migration.ts 后跑

BEGIN;

-- 探活：旧数据全在新 superset 内？(SELECT 仅供 Debug, 不阻塞 migration)
DO $$
DECLARE
  bad_status TEXT;
BEGIN
  SELECT status INTO bad_status
    FROM zenithjoy.publish_tasks
   WHERE status NOT IN ('pending','running','success','failed','done','queued','dispatched','in_progress','completed')
   LIMIT 1;
  IF bad_status IS NOT NULL THEN
    RAISE WARNING 'publish_tasks 含 status=% 不在新 superset，请人工 review', bad_status;
  END IF;
END $$;

-- 1. DROP 老 constraint（兼容 0c10fd migration 已创建的 DROP/ADD）
ALTER TABLE zenithjoy.publish_tasks
  DROP CONSTRAINT IF EXISTS chk_publish_tasks_status;

-- 2. ADD 新 constraint 含 9 个 status
ALTER TABLE zenithjoy.publish_tasks
  ADD CONSTRAINT chk_publish_tasks_status
  CHECK (status IN (
    'pending',     -- canonical, 新 INSERT 默认
    'queued',      -- canonical, 任务进派发队列
    'dispatched',  -- canonical, WS 消息已发
    'in_progress', -- canonical, agent 执行中
    'completed',   -- canonical, 成功
    'failed',      -- canonical, 失败
    'running',     -- deprecated since H-1, 等价 in_progress, sweep H-3
    'success',     -- deprecated since H-1, 等价 completed, sweep H-3
    'done'         -- deprecated since H-1, 等价 completed, sweep H-3
  ));

COMMENT ON CONSTRAINT chk_publish_tasks_status
  ON zenithjoy.publish_tasks IS
  'H-1 superset (9 status): canonical = pending/queued/dispatched/in_progress/completed/failed; deprecated since H-1 = running/success/done (sweep H-3 全代码 canonical 后删)';

COMMIT;
