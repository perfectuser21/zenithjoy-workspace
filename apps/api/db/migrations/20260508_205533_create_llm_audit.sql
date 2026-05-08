-- ws1 (Path 4 Sprint 1)
-- LLM 调用审计表 — 替代不存在的 llm.log 文件方案。
-- 每次调用 OpenRouter / 其他 LLM 都写一行（成功/失败都写）。

CREATE TABLE IF NOT EXISTS llm_audit (
  id                 BIGSERIAL PRIMARY KEY,
  provider           TEXT NOT NULL,           -- 'openrouter' / 'anthropic' / ...
  model              TEXT NOT NULL,           -- 'deepseek/deepseek-chat'
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  cost               NUMERIC(12, 8),          -- 单次调用成本（USD）
  request_purpose    TEXT,                    -- 'wechat_chat_draft' / 'moment_draft' / ...
  error              TEXT,                    -- 失败时的错误信息
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_created
  ON llm_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_audit_purpose
  ON llm_audit (request_purpose);
CREATE INDEX IF NOT EXISTS idx_llm_audit_model
  ON llm_audit (model);

COMMENT ON TABLE llm_audit IS 'LLM 调用审计 — 成本/token/失败原因记账，替代散乱日志';
