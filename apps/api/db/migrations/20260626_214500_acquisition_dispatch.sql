-- apps/api/db/migrations/20260626_214500_acquisition_dispatch.sql
-- 刀1：Line02 智能获客「分析+指派」中台大脑（架构 A — 薄指挥放中台）
-- 契约：scratchpad/dispatch-engine-contract.md「数据库」节
--
-- 1. acquisition_config       每租户一行，所有可调参数 + 默认值（中台配置页 GET/PUT）
-- 2. acquisition_leads        加列 relevance_score（0-100，NULL=未评分）
-- 3. dm_assignments           指派队列（②分析+指派 的产出，③执行 消费）
-- 4. dm_outreach_log          每条真发记录（卡频控 + 24h 去重）
--
-- 幂等：全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO $$ 探测约束。

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. acquisition_config（每租户一行，所有参数中台可调，带默认）──────────
CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_config (
  tenant_id                 text PRIMARY KEY,
  collect_rounds_per_day    int NOT NULL DEFAULT 2,
  keywords_per_round_min    int NOT NULL DEFAULT 3,
  keywords_per_round_max    int NOT NULL DEFAULT 5,
  collect_active_start      text NOT NULL DEFAULT '09:00',
  collect_active_end        text NOT NULL DEFAULT '21:00',
  burner_count              int NOT NULL DEFAULT 3,
  dm_per_hour               int NOT NULL DEFAULT 5,
  dm_per_day                int NOT NULL DEFAULT 30,
  dm_interval_min_sec       int NOT NULL DEFAULT 300,
  dm_interval_max_sec       int NOT NULL DEFAULT 900,
  dm_active_start           text NOT NULL DEFAULT '09:00',
  dm_active_end             text NOT NULL DEFAULT '22:00',
  nurture_per_day_min       int NOT NULL DEFAULT 1,
  nurture_per_day_max       int NOT NULL DEFAULT 2,
  cookie_check_interval_hours int NOT NULL DEFAULT 6,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE zenithjoy.acquisition_config IS
  '刀1 智能获客「分析+指派」配置 — 每租户一行，采集/触达/养号/cookie 全参数中台可调（dashboard GET/PUT）';

-- ── 2. acquisition_leads 加 relevance_score（0-100，NULL=未评分）──────────
ALTER TABLE zenithjoy.acquisition_leads
  ADD COLUMN IF NOT EXISTS relevance_score int;

COMMENT ON COLUMN zenithjoy.acquisition_leads.relevance_score IS
  '刀1 相关性评分 0-100（NULL=未评分）；scoreLeads 给未评分 leads 打分，buildAssignments 按此降序指派';

-- ── 3. dm_assignments（指派队列 — ②产出，③消费）──────────────────────────
-- lead_id 对齐 acquisition_leads 主键类型 uuid（见 20260618_190000_acquisition_collect.sql）
CREATE TABLE IF NOT EXISTS zenithjoy.dm_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  lead_id       uuid NOT NULL,
  account_label text NOT NULL,                 -- 指派给哪个小号 burner
  status        text NOT NULL DEFAULT 'queued',
  scheduled_for timestamptz,                   -- 随机间隔排期
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_dm_assign_status CHECK (status IN ('queued', 'dispatched', 'sent', 'limited', 'failed')),
  CONSTRAINT uq_dm_assign_tenant_lead_label UNIQUE (tenant_id, lead_id, account_label)
);

CREATE INDEX IF NOT EXISTS idx_dm_assign_tenant_status_sched
  ON zenithjoy.dm_assignments(tenant_id, status, scheduled_for);

COMMENT ON TABLE zenithjoy.dm_assignments IS
  '刀1 指派队列 — buildAssignments 产出（谁×哪个号×何时×状态），dispatchDue 消费；(tenant,lead,account_label) 唯一防重复指派';

-- ── 4. dm_outreach_log（每条真发记录，卡频控/去重）────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.dm_outreach_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account_label text NOT NULL,
  lead_id       uuid,
  profile_url   text,
  status        text NOT NULL DEFAULT 'sent',
  sent_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_outreach_tenant_label_sent
  ON zenithjoy.dm_outreach_log(tenant_id, account_label, sent_at);

COMMENT ON TABLE zenithjoy.dm_outreach_log IS
  '刀1 触达真发日志 — dispatchDue 每发一条写一行；buildAssignments/dispatchDue 查它做 per-hour/per-day 频控 + 24h 去重';
