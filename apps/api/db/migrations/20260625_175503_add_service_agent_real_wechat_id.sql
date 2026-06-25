-- Line04 per-operator：service_agents 加「真实微信号(SSOT) + 昵称 + 内部 wxid」三列
--
-- 背景（用户拍板 2026-06-25）：SSOT = 微信号（perfect-xx 这种可搜索 ID，用户视角"微信ID 就是微信号"）。
-- 现有 service_agents.wechat_id 是一键配置派生的合成 id（cs-<machine前8位>），不是真实微信号；
-- 它是 wechat_cs_account_config 的 PRIMARY KEY + crm_customers UNIQUE 的一部分，96 处引用，
-- 绝不能改它当 key（动 PK/UNIQUE/大日志表 = 极高风险）。故新增三列做 SSOT 锚点，合成 wechat_id 不动：
--
--   real_wechat_id      真实微信号（perfect-xx）= SSOT，对齐用户 Notion 名册。
--                       核实结论：wxauto4 GetSelfInfo/Self.WxId 只能读内部 wxid，读不到用户设的微信号，
--                       故 real_wechat_id 由运营一键配置时手填一次（界面只写"你的微信号"，不提 wxid）。
--   wechat_display_name 微信昵称（默忆）= 前端 display，可变；agent 上报（GetSelfInfo 能读昵称）。
--   wxid_internal       微信内部 ID（wxid_xxxx）= 后台校验/防绑错号用，agent 自动上报，绝不外露给用户。
--
-- 纯 ALTER ADD，不动任何 PK/UNIQUE/外键，无数据迁移。real_wechat_id 加部分唯一索引（非空才唯一），
-- 保证同一真实微信号不被两台 service_agent 重复认领（SSOT 唯一性），但允许多行 NULL（存量未填）。

ALTER TABLE zenithjoy.service_agents
  ADD COLUMN IF NOT EXISTS real_wechat_id      text,
  ADD COLUMN IF NOT EXISTS wechat_display_name text,
  ADD COLUMN IF NOT EXISTS wxid_internal       text;

COMMENT ON COLUMN zenithjoy.service_agents.real_wechat_id IS
  '真实微信号（perfect-xx，SSOT，用户视角的微信ID）；一键配置运营手填，对齐 Notion 名册。wxauto 读不到，故手填。';
COMMENT ON COLUMN zenithjoy.service_agents.wechat_display_name IS
  '微信昵称（默忆，前端 display，可变）；agent 心跳/扫码绑定上报。';
COMMENT ON COLUMN zenithjoy.service_agents.wxid_internal IS
  '微信内部 ID（wxid_xxxx）；agent 自动上报，后台校验/防绑错号用，绝不外露给用户。';

-- SSOT 唯一：非空 real_wechat_id 全局唯一（同一真实微信号不能被两台机器认领）；NULL 不参与唯一（存量可多 NULL）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_agents_real_wechat_id
  ON zenithjoy.service_agents (real_wechat_id)
  WHERE real_wechat_id IS NOT NULL AND deleted_at IS NULL;
