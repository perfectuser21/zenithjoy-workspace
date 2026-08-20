-- agents 表加设备就绪度字段（客户安卓手机准备好了没有）
--
-- 客服要能在中台看到「这台客户手机卡在哪一项」，而不是等客户打电话说"你们软件不好使"。
-- 形态沿用已有的 module_status（上报→归一→jsonb 落库→矩阵读出），但不共用同一个字段：
-- module_status 是 per-Line 模块 preflight，本字段是设备级权限就绪，语义不同不能混。
--
-- readiness 里同时存两类条目：
--   设备端上报的（无障碍真 Bound / 变体包冲突 / 截图授权 / 录音权限）
--   服务端自己知道的（license_binding——小白正在发生的「配额已满绑不上」设备端根本不知道）

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS readiness    JSONB,
  ADD COLUMN IF NOT EXISTS readiness_at TIMESTAMPTZ;
