-- Migration: 20260718_voice_call_records.sql
-- GP-A 主动语音触达 — voice_call_records 表
--
-- 设计要点（N-3/N-4）：
--   N-4  幂等 Migration：CREATE TABLE IF NOT EXISTS（重复运行安全）
--   N-3  多租户隔离：tenant_id 字段 + 索引（每次查询必须带 tenant_id 过滤）
--
-- 状态枚举（与 Python 实现保持一致）：
--   answered  — 接通并完成通话
--   no_answer — 60 秒内对方未接听
--   failed    — RPA/音频/系统异常导致失败

-- ────────────────────────────────────────────────────────────────────────────
-- 表结构
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_call_records (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        TEXT        NOT NULL,
    contact_name     TEXT        NOT NULL,
    wechat_account   TEXT,
    status           TEXT        NOT NULL CHECK (status IN ('answered', 'no_answer', 'failed')),
    duration_seconds INTEGER     NOT NULL DEFAULT 0,
    called_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    call_id          TEXT        UNIQUE,
    bubble_text      TEXT,
    error_reason     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 索引
-- ────────────────────────────────────────────────────────────────────────────

-- 多租户查询索引（N-3）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_tenant_id
    ON voice_call_records (tenant_id);

-- 联系人 + 租户联合索引（按联系人查通话历史）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_tenant_contact
    ON voice_call_records (tenant_id, contact_name);

-- 时间排序索引（最新通话优先）
CREATE INDEX IF NOT EXISTS idx_voice_call_records_called_at
    ON voice_call_records (called_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at 自动更新触发器
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_voice_call_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voice_call_records_updated_at ON voice_call_records;

CREATE TRIGGER trg_voice_call_records_updated_at
    BEFORE UPDATE ON voice_call_records
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_call_records_updated_at();
