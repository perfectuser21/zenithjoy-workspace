-- Line04 CRM「立即扫好友」迁移 — crm_onboarding_state 加 force_scan_requested_at
--
-- 网页用户点「立即扫好友」→ POST /api/crm/friend-scan/trigger 设 force_scan_requested_at=now()。
-- agent 每轮 GET /api/crm/friend-scan/pending 看到 force_scan_requested_at IS NOT NULL → 无视 24h 间隔立刻扫一轮。
-- 扫完 POST /friend-scan/ingest 成功后后端把该列置 NULL（消费掉这次强制请求）。
-- NULL = 无强制请求（按 agent 原有 24h 节奏）。
-- 幂等：ADD COLUMN IF NOT EXISTS。

ALTER TABLE zenithjoy.crm_onboarding_state
  ADD COLUMN IF NOT EXISTS force_scan_requested_at timestamptz NULL;

COMMENT ON COLUMN zenithjoy.crm_onboarding_state.force_scan_requested_at IS
  '网页「立即扫好友」请求时间戳；非空=有未消费的强制扫描请求，agent 应无视 24h 间隔立刻扫；ingest 成功后置 NULL';
