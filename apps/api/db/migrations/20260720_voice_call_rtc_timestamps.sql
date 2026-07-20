-- Migration: 20260720_voice_call_rtc_timestamps.sql
-- GP-A RTC 引擎迁移 — voice_call_records 新增 6 个延迟时间戳字段
--
-- N-4 幂等：ADD COLUMN IF NOT EXISTS
-- 6 个字段对应 PrepPRD 核心指标（Token签发/sidecar入房/AI入场/首音频包/TTS首字节/挂断清理）

ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS rtc_token_issued_at    TIMESTAMPTZ;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS sidecar_joined_at      TIMESTAMPTZ;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS ai_agent_joined_at     TIMESTAMPTZ;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS first_audio_at         TIMESTAMPTZ;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS tts_first_byte_at      TIMESTAMPTZ;
ALTER TABLE voice_call_records ADD COLUMN IF NOT EXISTS cleanup_done_at        TIMESTAMPTZ;
