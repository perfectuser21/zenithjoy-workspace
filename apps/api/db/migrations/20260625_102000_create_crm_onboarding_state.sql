-- Line04 CRM 重做 迁移 C — crm_onboarding_state onboarding 状态机（每客服机 O1-O5 自检态）
--
-- 一条 onboarding 状态机，让「首次导入做没做 / 名单建好没 / 真发开没 / 客户进来真回出去没」一眼可见。
--   O1 首次接入：客服机在线（service_agents heartbeat）
--   O2 agent 扫好友：scan_recent_contacts 上报，scanned_count = 拉到几人
--   O3 默认全接管 + 标黑名单：名册落库 + blacklist 初始化，blacklist_count = 黑名单几人
--   O4 开真发：真发开关打开 + pywinauto 可用
--   O5 客户进来 AI 回：首条真回出去（cs_memory_messages outbound + _delivery_confirmed）
-- 每步三态 pending|ok|fail。每客服机一行，UNIQUE (tenant_id, cs_wechat_id)。
-- 幂等：CREATE TABLE IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS zenithjoy.crm_onboarding_state (
  id                  BIGSERIAL PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES zenithjoy.tenants(id) ON DELETE CASCADE,
  cs_wechat_id        text NOT NULL,
  step_o1_online      text NOT NULL DEFAULT 'pending' CHECK (step_o1_online      IN ('pending','ok','fail')),
  step_o2_scanned     text NOT NULL DEFAULT 'pending' CHECK (step_o2_scanned     IN ('pending','ok','fail')),
  scanned_count       int  NOT NULL DEFAULT 0,
  step_o3_roster      text NOT NULL DEFAULT 'pending' CHECK (step_o3_roster      IN ('pending','ok','fail')),
  blacklist_count     int  NOT NULL DEFAULT 0,
  step_o4_realpublish text NOT NULL DEFAULT 'pending' CHECK (step_o4_realpublish IN ('pending','ok','fail')),
  step_o5_replied     text NOT NULL DEFAULT 'pending' CHECK (step_o5_replied     IN ('pending','ok','fail')),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cs_wechat_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_onboarding_state_tenant_cs
  ON zenithjoy.crm_onboarding_state (tenant_id, cs_wechat_id);

COMMENT ON TABLE zenithjoy.crm_onboarding_state IS
  'Line04 CRM onboarding 状态机（每客服机 O1-O5 自检态）；中台状态条数据源，每步由对应端点/agent 回执驱动';
