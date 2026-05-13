-- Path 4 Sprint 1 WS1 — LLM 调用审计表
--
-- 每次 OpenRouter 调用写一行, 留 cost / model / tokens / duration 痕迹.

CREATE TABLE IF NOT EXISTS zenithjoy.llm_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_purpose ON zenithjoy.llm_audit(request_purpose);
CREATE INDEX IF NOT EXISTS idx_llm_audit_created_at ON zenithjoy.llm_audit(created_at);
