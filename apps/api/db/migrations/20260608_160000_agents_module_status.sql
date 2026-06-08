-- Sprint 06081603 — Agent 模块健康状态持久化
-- 给 zenithjoy.agents 加 module_status 列，存客户机各 Line 模块最新 preflight 结果
-- 形如 {"line04-wechat-cs": {"ok": false, "reason": "wechat_version_4.2.0_unsupported"}, "line01-publish": {"ok": true}}
-- 注：PrepPRD 写的是 agent_installations，但本 repo 实际心跳落库表是 zenithjoy.agents，故加在此表。
ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS module_status jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN zenithjoy.agents.module_status IS '各 Line 模块最新 preflight 上报结果（客户端心跳写入，Dashboard 读取）';
