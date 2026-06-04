-- Path 4 微信客服回复引擎 Sprint A — 三层记忆落库
--
-- 两张表支撑 contact-memory.ts 的三层记忆：
--   zenithjoy.wechat_messages         短期：每联系人逐条对话原文（in=客户说 / out=我方回）
--   zenithjoy.wechat_contact_memory   中期(summary 滚动摘要) + 长期(facts 稳定事实) 固化产物
--
-- schema 前缀说明：apps/api/db/migrations 下所有表统一在 zenithjoy. schema
-- （run-migration.ts CREATE SCHEMA IF NOT EXISTS zenithjoy + wechat_publish_task 等
-- 全部带前缀），故本迁移两张表也加 zenithjoy. 前缀保持一致。

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_messages (
  id            BIGSERIAL PRIMARY KEY,
  contact_key   TEXT NOT NULL,
  sender_name   TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  content       TEXT NOT NULL,
  consolidated  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wechat_messages_contact_time
  ON zenithjoy.wechat_messages (contact_key, created_at);

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_contact_memory (
  contact_key          TEXT PRIMARY KEY,
  sender_name          TEXT,
  summary              TEXT NOT NULL DEFAULT '',
  facts                JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_consolidated_at TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
