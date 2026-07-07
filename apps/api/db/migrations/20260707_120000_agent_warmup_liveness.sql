-- Line02 Path2 Step7 —— warmup 每日养号验活结果落库
--
-- 设备级按真实抖音昵称 upsert：account_platform_sessions.account_label 是绑定时用户自起的
-- 任意串，与 warmup 读到的真实抖音昵称无映射（AgentService.kt 已登记的架构空白），故本表
-- 直接按 (agent_id, nickname) 存，每号只留最近一次验活。原始整份报告另存 publish_tasks.response。
CREATE TABLE IF NOT EXISTS zenithjoy.agent_warmup_liveness (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   uuid NOT NULL REFERENCES zenithjoy.agents(id) ON DELETE CASCADE,
  device_id  text,
  nickname   text NOT NULL,
  alive      boolean NOT NULL,
  followers  integer,
  reason     text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, nickname)
);

CREATE INDEX IF NOT EXISTS idx_agent_warmup_liveness_agent
  ON zenithjoy.agent_warmup_liveness(agent_id);

COMMENT ON TABLE zenithjoy.agent_warmup_liveness IS
  'Line02 每日养号验活结果，设备级按真实抖音昵称 upsert，每号留最新一次（alive/followers/reason/checked_at）';
