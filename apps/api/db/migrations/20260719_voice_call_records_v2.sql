-- Migration: 20260719_voice_call_records_v2.sql
-- GP-A 主动语音触达 — voice_call_records v2 schema + voice_outreach_rules 表
--
-- 本 migration 新增：
--   - voice_call_records 表添加派发状态机字段（I-9 call_phase / trigger_source / triggered_by / machine_id / transcript）
--   - voice_call_records 添加阶段时间戳列（claimed_at / dialing_at / answered_at）
--   - 新终态 ai_dropped（平台 TTS/ASR 断线后主动挂断）
--   - 新建 voice_outreach_rules 表（BEHAVIOR-5 自动规则引擎）
--
-- 设计要点（N-4 幂等 Migration：IF NOT EXISTS / 列存在时跳过）：
--   本文件重复执行安全（PostgreSQL DO $$ IF NOT EXISTS 判断）。
--
-- sprint: 07191407-gpa-dispatch-trigger  task: 2ac0e77b

-- ────────────────────────────────────────────────────────────────────────────
-- 1. voice_call_records 新增列（幂等 IF NOT EXISTS）
-- ────────────────────────────────────────────────────────────────────────────

-- call_phase：派发状态机（I-9）
-- 枚举值: queued / claimed / dialing / in_call / completed / failed / no_answer / ai_dropped
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS call_phase TEXT NOT NULL DEFAULT 'queued'
    CHECK (call_phase IN ('queued', 'claimed', 'dialing', 'in_call', 'completed', 'failed', 'no_answer', 'ai_dropped'));

-- trigger_source：触发来源
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS trigger_source TEXT;

-- triggered_by：触发者（user_id 或 'system'）
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS triggered_by TEXT;

-- machine_id：认领本任务的 Agent 机器 ID（I-11 熔断）
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS machine_id TEXT;

-- transcript：ASR 转写全文（I-2 音频桥接 → ASR 收集）
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS transcript TEXT;

-- claimed_at：agent 认领时间戳
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- dialing_at：进入拨号状态时间戳
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS dialing_at TIMESTAMPTZ;

-- answered_at：接通时间戳
ALTER TABLE voice_call_records
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. call_phase 索引（N-1 轮询性能 — GET /pending WHERE call_phase='queued'）
-- ────────────────────────────────────────────────────────────────────────────

-- idx_voice_call_records_phase：Agent 轮询 GET /pending 专用
CREATE INDEX IF NOT EXISTS idx_voice_call_records_phase
  ON voice_call_records (call_phase)
  WHERE call_phase IN ('queued', 'claimed', 'dialing', 'in_call');

-- 复合索引：租户 + 阶段（多租户场景下轮询更高效）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_tenant_phase
  ON voice_call_records (tenant_id, call_phase);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. voice_outreach_rules 表（BEHAVIOR-5 自动规则引擎，I-12 冷却期）
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_outreach_rules (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT        NOT NULL,
    name             TEXT        NOT NULL,
    condition_expr   TEXT        NOT NULL,       -- SQL WHERE 表达式（白名单校验）
    dry_run          BOOLEAN     NOT NULL DEFAULT TRUE,  -- N-8 预览模式
    enabled          BOOLEAN     NOT NULL DEFAULT TRUE,  -- 一键关闭功能
    cooldown_days    INTEGER     NOT NULL DEFAULT 3,     -- I-12 冷却期（天）
    trigger_source   TEXT        NOT NULL DEFAULT 'auto_rule',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at       TIMESTAMPTZ
);

-- 多租户索引
CREATE INDEX IF NOT EXISTS idx_voice_outreach_rules_tenant_enabled
  ON voice_outreach_rules (tenant_id, enabled)
  WHERE deleted_at IS NULL AND enabled = TRUE;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. voice_outreach_rules updated_at 触发器
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_voice_outreach_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voice_outreach_rules_updated_at ON voice_outreach_rules;

CREATE TRIGGER trg_voice_outreach_rules_updated_at
  BEFORE UPDATE ON voice_outreach_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_voice_outreach_rules_updated_at();
