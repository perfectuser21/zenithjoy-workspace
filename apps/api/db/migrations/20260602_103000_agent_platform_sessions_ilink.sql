-- Path 4 Step 1：agent_platform_sessions 扩展以支持微信 iLink 个人号通道
--
-- iLink 与抖音/快手不同：session 凭据（Bearer token）必须存在服务端（中台轮询用），
-- 而非 Agent 本地。所以加一个 extra_json 列存 token/uin/wxid。
-- 同时扩展 status CHECK，加入 iLink 生命周期需要的 'bound'（已扫码绑定）和
-- 'needs_rebind'（errcode=-14 会话超时，需重新扫码）。
--
-- 幂等：列/约束存在则跳过。

-- 1. extra_json 列（存 iLink token/uin/wxid 等服务端凭据）
ALTER TABLE zenithjoy.agent_platform_sessions
  ADD COLUMN IF NOT EXISTS extra_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. 扩展 status CHECK 约束，加入 bound / needs_rebind
ALTER TABLE zenithjoy.agent_platform_sessions
  DROP CONSTRAINT IF EXISTS chk_aps_status;

ALTER TABLE zenithjoy.agent_platform_sessions
  ADD CONSTRAINT chk_aps_status CHECK (
    status IN ('pending', 'active', 'connected', 'offline', 'expired', 'bound', 'needs_rebind')
  );

COMMENT ON COLUMN zenithjoy.agent_platform_sessions.extra_json IS
  'iLink 等需要服务端保存凭据的通道：{ token, uin, wxid, nickname }。抖音/快手 session 在 Agent 本地，此列为空。';
