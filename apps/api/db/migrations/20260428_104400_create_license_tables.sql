-- ZenithJoy v1.2 License 系统 — Day 1-2
--
-- 表：
--   zenithjoy.licenses          — license key / 套餐 / 客户 / 配额 / 状态
--   zenithjoy.license_machines  — 装机绑定（license_id × machine_id 唯一）
--
-- 套餐配额（max_machines）：
--   basic       1
--   matrix      3
--   studio     10
--   enterprise 30
--
-- 向后兼容：v1.1 Agent 不依赖 license 表，旧 Agent 在线状态不受影响。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS zenithjoy.licenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key     TEXT UNIQUE NOT NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('basic','matrix','studio','enterprise')),
  max_machines    INTEGER NOT NULL,
  customer_id     TEXT,
  customer_name   TEXT,
  customer_email  TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','expired','revoked','suspended')),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_licenses_customer ON zenithjoy.licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status   ON zenithjoy.licenses(status);

CREATE TABLE IF NOT EXISTS zenithjoy.license_machines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  UUID NOT NULL REFERENCES zenithjoy.licenses(id) ON DELETE CASCADE,
  machine_id  TEXT NOT NULL,
  agent_id    TEXT,
  hostname    TEXT,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL DEFAULT 'active',
  UNIQUE(license_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_license_machines_lookup
  ON zenithjoy.license_machines(license_id, machine_id);
