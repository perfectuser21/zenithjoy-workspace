-- Sprint 07052218 — 抖音私信主动触达 Android 执行路径
--
-- 既有断点修复（跨平台，非 Android 专属）：apps/api/src/routes/acquisition-dispatch.ts
-- 的 GET /outreach-history 早就在 JOIN ol.assignment_id = a.id，但 dm_outreach_log 表
-- 从未建过 assignment_id 列，该查询命中 catch 分支静默吞掉异常返回空列表。
--
-- 幂等安全：IF NOT EXISTS + 不设 NOT NULL，历史行默认 NULL，不影响既有查询路径
-- （Windows 路径回归测试 services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts
-- 不依赖该列）。
ALTER TABLE zenithjoy.dm_outreach_log
  ADD COLUMN IF NOT EXISTS assignment_id uuid;

CREATE INDEX IF NOT EXISTS idx_dm_outreach_log_assignment_id
  ON zenithjoy.dm_outreach_log(assignment_id);

COMMENT ON COLUMN zenithjoy.dm_outreach_log.assignment_id IS
  '关联 zenithjoy.dm_assignments.id，用于 outreach-history 联表 + /dm-outreach-result 幂等判定';
