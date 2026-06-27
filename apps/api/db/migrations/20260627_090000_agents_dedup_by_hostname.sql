-- 身份统一：同 (tenant_id, hostname) 一台机器只保留一行
--
-- 根因（真机 XX-ROG 查证）：同一台机器在 zenithjoy.agents 裂成两行——
--   心跳身份 ws1-<hash>（upsertAgentByHeartbeat 生成）+ WS 连接身份 agent-env-<ts>（findOrCreateAgentUuid）。
-- 派单投一个、agent 收任务/发事件用另一个 → qr-bind 任务卡 queued、事件不浮现。
--
-- 本 migration：
--   1. 存量合并：同 (tenant_id, hostname)(hostname 非空) 的多行 → 保留「被引用最多 / 最早」的一行，
--      把 publish_tasks / agent_platform_sessions / agent_events 的 agent_id 指向保留行，删冗余行。
--   2. 防回归：建 partial unique index (tenant_id, hostname) WHERE hostname 非空，
--      新行不再裂（代码层 select-then-update 兜底，此索引是数据库层硬约束）。
--
-- 注意类型：publish_tasks.agent_id / agent_platform_sessions.agent_id 是 uuid（FK→agents.id）；
--           agent_events.agent_id 是 text（存 agents.id 字符串）。合并时分别处理。
-- 幂等：纯条件逻辑 + IF NOT EXISTS，可重入。

CREATE SCHEMA IF NOT EXISTS zenithjoy;

BEGIN;

-- ==================== 1. 存量合并 ====================
DO $$
DECLARE
  grp RECORD;       -- 一组 (tenant_id, hostname) 下的多行
  keep_id uuid;     -- 保留行
  dup_ids uuid[];   -- 冗余行（合并掉）
BEGIN
  FOR grp IN
    SELECT tenant_id, hostname
      FROM zenithjoy.agents
     WHERE hostname IS NOT NULL AND hostname <> ''
     GROUP BY tenant_id, hostname
    HAVING count(*) > 1
  LOOP
    -- 保留行：被 publish_tasks 引用最多者优先，其次最早创建
    SELECT a.id INTO keep_id
      FROM zenithjoy.agents a
      LEFT JOIN (
        SELECT agent_id, count(*) AS n
          FROM zenithjoy.publish_tasks
         GROUP BY agent_id
      ) pt ON pt.agent_id = a.id
     WHERE a.tenant_id = grp.tenant_id AND a.hostname = grp.hostname
     ORDER BY COALESCE(pt.n, 0) DESC, a.created_at ASC
     LIMIT 1;

    SELECT array_agg(a.id) INTO dup_ids
      FROM zenithjoy.agents a
     WHERE a.tenant_id = grp.tenant_id AND a.hostname = grp.hostname
       AND a.id <> keep_id;

    IF dup_ids IS NULL THEN
      CONTINUE;
    END IF;

    -- 重指引用（uuid FK 两张表）
    UPDATE zenithjoy.publish_tasks
       SET agent_id = keep_id
     WHERE agent_id = ANY(dup_ids);

    -- agent_platform_sessions 有 UNIQUE(agent_id, platform, account_label)，
    -- 改指可能撞已存在的保留行记录 → 先删冲突的冗余行，再改剩余
    DELETE FROM zenithjoy.agent_platform_sessions s
     WHERE s.agent_id = ANY(dup_ids)
       AND EXISTS (
         SELECT 1 FROM zenithjoy.agent_platform_sessions k
          WHERE k.agent_id = keep_id
            AND k.platform = s.platform
            AND k.account_label = s.account_label
       );
    UPDATE zenithjoy.agent_platform_sessions
       SET agent_id = keep_id
     WHERE agent_id = ANY(dup_ids);

    -- agent_events.agent_id 是 text（存 UUID 字符串）
    UPDATE zenithjoy.agent_events
       SET agent_id = keep_id::text
     WHERE agent_id = ANY(SELECT unnest(dup_ids)::text);

    -- license.pinned_agent_id 指向冗余行 → 收敛到保留行
    UPDATE zenithjoy.licenses
       SET pinned_agent_id = keep_id
     WHERE pinned_agent_id = ANY(dup_ids);

    -- 删冗余 agents 行（FK ON DELETE SET NULL/CASCADE 已无悬挂引用）
    DELETE FROM zenithjoy.agents WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

-- ==================== 2. 防回归唯一索引 ====================
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_hostname
  ON zenithjoy.agents (tenant_id, hostname)
  WHERE hostname IS NOT NULL AND hostname <> '';

COMMENT ON INDEX zenithjoy.uq_agents_tenant_hostname IS
  '身份统一：同 (tenant_id, hostname) 一台机器只一行（hostname 非空时硬约束，防裂行）';

COMMIT;
