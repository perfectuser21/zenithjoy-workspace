-- Line02 机器管理模块 — zenithjoy.agents 加 nickname + machine_role
--
-- 背景（sprint 06260400 机器管理 thin）：把既有零件（agents 机器表 / agent_platform_sessions
-- 抖音号表 / qr-bind 派单）组装成统一「机器管理」后台。运营需要给机器命名（nickname）并标记
-- 主机器/副机器（machine_role），故给 agents 表补两列。
--
--   nickname      机器昵称（运营命名，可空；新注册机器默认 NULL，列表显示 hostname 兜底由前端处理）。
--   machine_role  机器主副（NOT NULL DEFAULT 'main'，CHECK 钉死 'main'/'sub'）。
--                 ⚠️ 这是「机器」的主副，独立于 agent_platform_sessions.role（号的 main/burner），
--                 故用独立枚举 ('main','sub')，不复用号的 ('main','burner')。
--
-- 纯 ALTER ADD，不动 PK / UNIQUE / 外键，无数据迁移。幂等：ADD COLUMN IF NOT EXISTS（E2E smoke 可重入）。
-- CHECK 约束用 DO 块条件加（ADD CONSTRAINT 不支持 IF NOT EXISTS，重复跑用 pg_constraint 探测避免报错）。

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS nickname     text,
  ADD COLUMN IF NOT EXISTS machine_role text NOT NULL DEFAULT 'main';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_agents_machine_role'
  ) THEN
    ALTER TABLE zenithjoy.agents
      ADD CONSTRAINT chk_agents_machine_role
      CHECK (machine_role IN ('main', 'sub'));
  END IF;
END $$;

COMMENT ON COLUMN zenithjoy.agents.nickname IS
  '机器昵称（运营在机器管理页命名，可空）。';
COMMENT ON COLUMN zenithjoy.agents.machine_role IS
  '机器主副 main/sub（运营标记，≠ agent_platform_sessions.role 的 main/burner）。';
