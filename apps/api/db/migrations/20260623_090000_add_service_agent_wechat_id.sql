-- Line04 客户机接线：service_agents 加 wechat_id 列（决策 143f5d00）
--
-- 背景：每客服配置按 wechat_id 物理分行（PR #825 / 决策 04c34b86），但客户机只可靠持有
-- machine_id（agent 注册时带）。agents.id 那个 UUID 与 service_agents 无直接链，唯一通用
-- join 键是 machine_id。故在客服-PC 绑定表 service_agents 上加 wechat_id，管理员前台手填
-- 该客服微信号 = 该客服配置主 key；客户机用本机 machine_id → service_agents.wechat_id →
-- 拉自己那份配置（不靠 RPA 读真实微信号）。
--
-- 可空：存量绑定还没填微信号；getCSConfigByMachine 对空 wechat_id 返回 null（强制 dryrun，
-- 绝不误真发），等管理员前台补填。

ALTER TABLE zenithjoy.service_agents
  ADD COLUMN IF NOT EXISTS wechat_id text;

COMMENT ON COLUMN zenithjoy.service_agents.wechat_id IS
  '该客服绑定的微信号（管理员前台手填）= 每客服配置 wechat_cs_account_config 的主 key；客户机按 machine_id 反查它拉自己那份配置';
