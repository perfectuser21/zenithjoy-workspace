-- Path 4 微信客服中台配置页 Sprint B — 人设/企业知识库搬上中台落库
--
-- 一张 key-value 表存运营在中台编辑、保存即生效的配置：
--   zenithjoy.wechat_cs_config
--     key='persona'      → value = Persona JSON（覆盖 apps/api/config/wechat-persona.json）
--     key='business_kb'  → value = BusinessKB JSON（覆盖 apps/api/config/wechat-business-kb.json）
--
-- 读取走 cs-config-store.ts：有行→DB 值；无行/DB 失败→回落 loadPersona()/loadBusinessKB() 兜底。
--
-- schema 前缀说明：apps/api/db/migrations 下所有表统一在 zenithjoy. schema
-- （run-migration.ts CREATE SCHEMA IF NOT EXISTS zenithjoy），故本表也加 zenithjoy. 前缀保持一致。

CREATE TABLE IF NOT EXISTS zenithjoy.wechat_cs_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
