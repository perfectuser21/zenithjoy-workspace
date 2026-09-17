-- 朋友圈发布接入 OpenClaw 调度（PrepPRD sprints/09171039-moments-publish-openclaw）。
-- wechat_publish_task.status 原枚举没有"已被领走/执行中"这个中间态，导致两个调度周期
-- 可能同时领到同一条已批准的朋友圈重复发布（判定点：跨调度实例并发领单，见 Brain
-- strategic-decisions）。新增 claimed / executing 两态，配合 claimed_at 做超时回收
-- （领取超过 10 分钟未转 executing/终态 视为孤儿，允许重新领取——由应用层 SQL 实现，
-- 这里只加字段和枚举值）。
-- 全部 DDL 幂等：CI 重放全部 migration。不包 BEGIN/COMMIT（run-migration.ts 已包外层事务）。

ALTER TABLE zenithjoy.wechat_publish_task
  DROP CONSTRAINT IF EXISTS wechat_publish_task_status_check;

ALTER TABLE zenithjoy.wechat_publish_task
  ADD CONSTRAINT wechat_publish_task_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text, 'approved'::text, 'rejected'::text,
    'claimed'::text, 'executing'::text,
    'sent'::text, 'failed'::text, 'auto_sent'::text,
    'pending_human'::text, 'send_failed'::text
  ]));

ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
-- dispatch_meta 落最小可观测字段集（判定点表约定）：
-- dump_attempt_count / dump_fail_count / vision_fallback_triggered / vision_call_count /
-- vision_latency_ms / publish_attempt_at / publish_confirmed_at / fail_reason_code

CREATE INDEX IF NOT EXISTS idx_wechat_publish_task_claimed_at
  ON zenithjoy.wechat_publish_task (claimed_at)
  WHERE status IN ('claimed', 'executing');
