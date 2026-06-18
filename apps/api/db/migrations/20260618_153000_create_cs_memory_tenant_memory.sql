-- Line04 对话记忆三层后端 — tenant 隔离的三层记忆（短期 / 中期 / 长期）
--
-- per tenant_id × contact 的三层记忆，物理独立于旧 contact_key 单键引擎
-- （zenithjoy.wechat_messages / wechat_contact_memory，本刀不动它们）：
--   zenithjoy.cs_memory_messages   短期：原文逐条滑窗（in=客户说 / out=我方回）
--   zenithjoy.cs_memory_daily      中期：按天 summary（一天一行）
--   zenithjoy.cs_memory_longterm   长期：融合压缩 summary（一 tenant×contact 一行）
--
-- 隔离纪律：所有表带 tenant_id，读写一律按 (tenant_id, contact) 过滤，绝不跨租户。
-- 全部 CREATE ... IF NOT EXISTS（幂等，E2E smoke 可重入）。schema 前缀统一 zenithjoy。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

-- ── 短期：原文逐条滑窗 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.cs_memory_messages (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  contact     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('in', 'out')),
  text        TEXT NOT NULL,
  msg_day     DATE NOT NULL DEFAULT (now()::date),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_memory_messages_tenant_contact_time
  ON zenithjoy.cs_memory_messages (tenant_id, contact, created_at);

-- ── 中期：按天 summary ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.cs_memory_daily (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  contact      TEXT NOT NULL,
  summary_day  DATE NOT NULL,
  summary      TEXT NOT NULL,
  folded       BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_memory_daily_tenant_contact_day
  ON zenithjoy.cs_memory_daily (tenant_id, contact, summary_day);

-- ── 长期：融合压缩 summary ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.cs_memory_longterm (
  tenant_id          TEXT NOT NULL,
  contact            TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  merged_through_day DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, contact)
);
CREATE INDEX IF NOT EXISTS idx_cs_memory_longterm_tenant_contact
  ON zenithjoy.cs_memory_longterm (tenant_id, contact);
