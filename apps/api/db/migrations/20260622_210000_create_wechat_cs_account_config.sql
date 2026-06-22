-- Line04 每客服独立配置 + 客户机按身份拉配置（中台多租户隔离 thin→medium）
--
-- 背景：原先只有一行全局 zenithjoy.wechat_cs_config（key-value），客户 A 设人设后所有客户
-- 都被覆盖（Issue defe1a42 人设串台）。本迁移建「按微信号 key 物理分行」的每客服配置表，
-- 让「一个公司 N 个客服 = N 个微信号 = N 行配置」成立，写一行绝不影响另一行（决策 04c34b86）。
--
-- 两张表：
--   zenithjoy.wechat_cs_account_config  每客服那一行（key = 绑定微信号 wechat_id）
--   zenithjoy.wechat_cs_identity_alert  客户机登录号 ≠ 绑定号 / 未注册号拉配置 的身份校验异常（诊断页数据源）
--
-- schema 前缀：apps/api/db/migrations 下所有表统一在 zenithjoy. schema（run-migration.ts
-- CREATE SCHEMA IF NOT EXISTS zenithjoy），故本表也加 zenithjoy. 前缀。

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_cs_account_config (
  wechat_id            TEXT PRIMARY KEY,                 -- 该客服绑定微信号 = 每客服配置主 key，全局唯一
  persona              JSONB NOT NULL,                   -- 该客服人设（Persona JSON）
  auto_agent_enabled   BOOLEAN NOT NULL DEFAULT false,   -- 真发总开关，默认关 = dryrun（绝不在没人配过时真发）
  business_hours_start TEXT NOT NULL DEFAULT '06:00',
  business_hours_end   TEXT NOT NULL DEFAULT '24:00',
  key_contact_wechat   TEXT NOT NULL DEFAULT '',
  whitelist            JSONB NOT NULL DEFAULT '[]'::jsonb,-- 该客服名单内客户白名单
  daily_limit          INTEGER NOT NULL DEFAULT 0,        -- 每日单号自动回上限，0 = 不限
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_cs_identity_alert (
  id         BIGSERIAL PRIMARY KEY,
  wechat_id  TEXT NOT NULL,                              -- 触发异常的微信号（登录号/未注册号）
  reason     TEXT NOT NULL,                              -- 异常原因（如 unregistered_wechat）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wechat_cs_identity_alert_created_at
  ON zenithjoy.wechat_cs_identity_alert (created_at DESC);

-- 存量全局配置向后兼容迁移：把旧的全局单行 zenithjoy.wechat_cs_config（key='persona'/'auto_agent'）
-- 原样搬进每客服表的 'wxid_legacy_global' 那一行（占位 marker；部署期 ops 把它改绑 xian-rog 现客服真号）。
-- 仅当存在全局 persona 行时才迁移；ON CONFLICT DO NOTHING 保证幂等（重复跑不重复插/不覆盖）。
-- 注：run-migration.ts 的 backfillLegacyCSConfig() 会在每次 `npm run migrate` 后再幂等跑一遍同款 SQL，
-- 以满足「先种存量再 migrate 也能迁过去」的可重跑要求（合同 DoD）。
INSERT INTO zenithjoy.wechat_cs_account_config
  (wechat_id, persona, auto_agent_enabled, business_hours_start, business_hours_end, key_contact_wechat, whitelist, daily_limit)
SELECT
  'wxid_legacy_global',
  COALESCE(p.value, '{}'::jsonb),
  COALESCE((a.value->>'auto_agent_enabled')::boolean, false),
  COALESCE(a.value->>'business_hours_start', '06:00'),
  COALESCE(a.value->>'business_hours_end', '24:00'),
  COALESCE(a.value->>'key_contact_wechat', ''),
  '[]'::jsonb,
  COALESCE((a.value->>'daily_limit')::int, 0)
FROM zenithjoy.wechat_cs_config p
LEFT JOIN zenithjoy.wechat_cs_config a ON a.key = 'auto_agent'
WHERE p.key = 'persona'
ON CONFLICT (wechat_id) DO NOTHING;
