-- Agent 身份唯一化：按机器指纹(machine_id)去重，而非机型名(hostname)
--
-- 真机实证（2026-08-19 办公室机队）：安卓端上报的 hostname = android.os.Build.MODEL，
-- 是【机型名】不是机器名。小黄与四号机同为荣耀 MAA-AN00，被 uq_agents_tenant_hostname
-- 约束认成同一台，共用一行 agents、共用 agent_id —— 派任务给该 id 时哪台真正执行不确定。
-- 当天由此产生四次误判（以为小黄被冻结/以为小白搜索失败/以为四号机 CI 跑的是新包/
-- 以为私信闸是人工卡点），全是身份混淆造成的假象。
--
-- machine_id（MachineFingerprint = SHA-256(ANDROID_ID + 机型) 前 32 位）早已随心跳与注册
-- 上报，license_machines 也一直在存它；只是 agents 表没有该列、去重没用它。
-- CI 侧早有先例：nightly-android-fleet-pc4.yml「按硬件序列号去重，防同一物理设备双 entry
-- 并发互踩」。本迁移把同一原则落到中台。
--
-- 兼容性：hostname 保留作显示与兜底。桌面 agent 上报真机器名、旧版安卓 agent 未上报指纹，
-- 二者仍按 hostname 去重 —— 不破坏 2026-06-27 的防裂行修复（uq_agents_tenant_hostname），
-- 只是把它的作用范围收窄到「没有 machine_id 的行」，避免两个索引对同一行重复约束。

BEGIN;

-- 1) 新列
ALTER TABLE zenithjoy.agents ADD COLUMN IF NOT EXISTS machine_id text;

COMMENT ON COLUMN zenithjoy.agents.machine_id IS
  '机器指纹（安卓 = SHA-256(ANDROID_ID+机型) 前32位；桌面 = computeMachineId()）。身份去重主键，同机型不同物理机互异。';

-- 2) 从 license_machines 回填已知映射（该表一直在记 machine_id ↔ agent_id）
UPDATE zenithjoy.agents a
   SET machine_id = lm.machine_id
  FROM zenithjoy.license_machines lm
 WHERE a.machine_id IS NULL
   AND lm.agent_id IS NOT NULL
   AND lm.agent_id = a.agent_id
   AND lm.machine_id IS NOT NULL
   AND lm.machine_id <> '';

-- 3) 回填后可能出现同 (tenant_id, machine_id) 多行（历史裂行）→ 只保留 last_seen 最新的一行，
--    其余行的 machine_id 置空，让它们继续走 hostname 兜底，不因建唯一索引失败而中断迁移。
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY tenant_id, machine_id
                            ORDER BY last_seen DESC NULLS LAST, updated_at DESC NULLS LAST) AS rn
    FROM zenithjoy.agents
   WHERE machine_id IS NOT NULL AND machine_id <> ''
)
UPDATE zenithjoy.agents a
   SET machine_id = NULL
  FROM ranked r
 WHERE a.id = r.id AND r.rn > 1;

-- 4) 新唯一索引：同租户同机器只一行
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_machine_id
  ON zenithjoy.agents (tenant_id, machine_id)
  WHERE machine_id IS NOT NULL AND machine_id <> '';

COMMENT ON INDEX zenithjoy.uq_agents_tenant_machine_id IS
  '身份统一：同 (tenant_id, machine_id) 一台物理机只一行。machine_id 非空时生效，取代 hostname 去重。';

-- 5) 旧 hostname 索引收窄到「没有 machine_id 的行」——否则同机型两台手机即便 machine_id
--    已区分，仍会被 hostname 索引挡住无法各自建行。
DROP INDEX IF EXISTS zenithjoy.uq_agents_tenant_hostname;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_hostname
  ON zenithjoy.agents (tenant_id, hostname)
  WHERE (machine_id IS NULL OR machine_id = '') AND hostname IS NOT NULL AND hostname <> '';

COMMENT ON INDEX zenithjoy.uq_agents_tenant_hostname IS
  '兜底身份统一（仅对未上报 machine_id 的 agent 生效）：同 (tenant_id, hostname) 一行，防裂行。';

COMMIT;
