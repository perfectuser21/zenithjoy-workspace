-- 西安机群CI基础设施 Sprint（07202259-xian-runner-fleet）
-- agents 表加 owner_type 字段，区分「内部机群机器」vs「客户设备」
--
-- owner_type:
--   'internal_fleet' = 公司自有西安机群（CI runner + RPA 验证机）
--   'customer'       = 客户部署的 zenithjoy-agent（既有默认值）
--
-- 决策依据：PrepPRD 判定点 decision e035dad8（不加白名单审批，由 owner_type 字段在 UI 层做展示区分）
--
-- 幂等：IF NOT EXISTS 保护，可重复执行。

ALTER TABLE zenithjoy.agents
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_agents_owner_type'
       AND conrelid = 'zenithjoy.agents'::regclass
  ) THEN
    ALTER TABLE zenithjoy.agents
      ADD CONSTRAINT chk_agents_owner_type CHECK (owner_type IN ('internal_fleet', 'customer'));
  END IF;
END
$$;

COMMENT ON COLUMN zenithjoy.agents.owner_type IS
  'Sprint 07202259：机器归属类型。internal_fleet = 公司自有西安机群 CI/RPA 验证机；customer = 客户部署机器（既有默认）。';

-- 索引（机器管理页按 owner_type 分 tab，高频 filter 场景）
CREATE INDEX IF NOT EXISTS idx_agents_owner_type ON zenithjoy.agents(owner_type);
