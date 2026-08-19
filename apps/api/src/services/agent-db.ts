import pool from '../db/connection';

export interface UpsertAgentParams {
  tenantId: string;
  agentId: string;
  capabilities: string[];
  version: string;
  platform?: string;
  hostname?: string;
}

/**
 * 身份统一去重（修真机 XX-ROG 裂两行 → qr-bind 卡 queued）：
 * 同一台机器以前会因为上报的 agent_id 字符串不同（心跳 ws1-<hash> vs WS 连接 agent-env-<ts>）
 * 而在 agents 表裂成多行。
 *
 * 真机复现(2026-07-29，客户已交付环境)：旧实现用 SELECT-then-branch 两步模式去重
 * （先查 (tenant_id, hostname) 有没有已有行，查不到才走 INSERT ... ON CONFLICT(agent_id)）——
 * 这是经典 TOCTOU 竞态：设备重装/快速重连时多个并发连接同时 SELECT 不到现有行(前一个
 * 事务还没提交)，都各自走向 INSERT 分支，第二个 INSERT 撞上 (tenant_id, hostname) 这个
 * partial unique index，但 ON CONFLICT 只处理了 agent_id 这一个冲突目标，直接抛未捕获的
 * duplicate key 异常（staging 真实日志：upsertAgent failed: duplicate key value violates
 * unique constraint "uq_agents_tenant_hostname"），整个注册流程失败。
 *
 * 改用单条原子 INSERT ... ON CONFLICT (tenant_id, hostname) DO UPDATE（hostname 非空时），
 * 消除 SELECT 和 INSERT 之间的竞态窗口——已用真实库验证过两次并发 INSERT 都不再报错，
 * 最终只留一行（agent_id 收敛为最后一次上报值）。
 */
export async function upsertAgent(p: UpsertAgentParams): Promise<void> {
  const hostname = typeof p.hostname === 'string' ? p.hostname.trim() : '';

  if (hostname) {
    await pool.query(
      `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, hostname, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, 'online', now())
       -- 2026-08-19：索引条件随 uq_agents_tenant_hostname 收窄同步更新。ON CONFLICT 的
       -- 推断条件必须与 partial unique index 的 WHERE 逐字匹配，否则 Postgres 报
       -- "there is no unique or exclusion constraint matching the ON CONFLICT specification"。
       -- hostname 去重现在只对【没有 machine_id 的行】生效（有指纹的走 uq_agents_tenant_machine_id）。
       ON CONFLICT (tenant_id, hostname)
         WHERE (machine_id IS NULL OR machine_id = '') AND hostname IS NOT NULL AND hostname <> ''
       DO UPDATE
         SET agent_id     = EXCLUDED.agent_id,
             capabilities = EXCLUDED.capabilities,
             version      = EXCLUDED.version,
             status       = 'online',
             last_seen    = now(),
             updated_at   = now()`,
      [p.tenantId, p.agentId, p.capabilities, p.version, hostname],
    );
    return;
  }

  await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, hostname, status, last_seen)
     VALUES ($1, $2, $3, $4, $5, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id    = EXCLUDED.tenant_id,
           capabilities = EXCLUDED.capabilities,
           version      = EXCLUDED.version,
           hostname     = COALESCE(EXCLUDED.hostname, zenithjoy.agents.hostname),
           status       = 'online',
           last_seen    = now(),
           updated_at   = now()`,
    [p.tenantId, p.agentId, p.capabilities, p.version, hostname || null]
  );
}

export async function touchAgentHeartbeat(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.agents SET last_seen = now(), updated_at = now() WHERE agent_id = $1`,
    [agentId]
  );
}

export async function setAgentOffline(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.agents SET status = 'offline', updated_at = now() WHERE agent_id = $1`,
    [agentId]
  );
}

// H-1 ws3 — WS routing UUID 化 helper
//
// 把老 v1.0 Agent 发的 string agentId (display name) 转成 UUID (agents.id)
// 用 INSERT ... ON CONFLICT (agent_id) DO UPDATE 一句搞定避免竞态
//
// 调用：agent-ws.ts hello message handler 收到 string agentId 时调本函数
// 返回：{ uuid (= agents.id), displayName (= 入参) }
export interface FindOrCreateAgentUuidParams {
  displayName: string;        // 来自 hello.agentId 的 TEXT (老 v1.0 格式)
  tenantId: string | null;    // 来自 ws upgrade 验过的 license（兼容历史 NULL）
  capabilities: string[];
  version: string;
  hostname?: string | null;   // 身份统一：同 (tenant_id, hostname) 复用去重行
}

export interface FindOrCreateAgentUuidResult {
  uuid: string;                // = agents.id
  displayName: string;         // 入参回显
}

export async function findOrCreateAgentUuid(
  params: FindOrCreateAgentUuidParams
): Promise<FindOrCreateAgentUuidResult> {
  // 身份统一：hostname 非空且 tenantId 非 null → 单条原子 INSERT...ON CONFLICT(tenant_id,hostname)
  // 复用同 (tenant_id, hostname) 行（不因 displayName 不同新增）。同 upsertAgent 的竞态修复——
  // 不再是 SELECT 探测有没有已有行再决定 UPDATE/INSERT 的两步模式，消除 TOCTOU 竞态窗口。
  const hostname = typeof params.hostname === 'string' ? params.hostname.trim() : '';
  if (hostname && params.tenantId) {
    const upsert = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, hostname, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, 'online', now())
       -- 同上：条件须与 uq_agents_tenant_hostname 的 partial index WHERE 逐字一致
       ON CONFLICT (tenant_id, hostname)
         WHERE (machine_id IS NULL OR machine_id = '') AND hostname IS NOT NULL AND hostname <> ''
       DO UPDATE
         SET agent_id     = EXCLUDED.agent_id,
             capabilities = EXCLUDED.capabilities,
             version      = EXCLUDED.version,
             status       = 'online',
             last_seen    = now(),
             updated_at   = now()
       RETURNING id`,
      [params.tenantId, params.displayName, params.capabilities, params.version, hostname],
    );
    return {
      uuid: upsert.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000',
      displayName: params.displayName,
    };
  }

  const r = await pool.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, hostname, status, last_seen)
     VALUES ($1, $2, $3, $4, $5, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id    = COALESCE(EXCLUDED.tenant_id, zenithjoy.agents.tenant_id),
           capabilities = EXCLUDED.capabilities,
           version      = EXCLUDED.version,
           hostname     = COALESCE(EXCLUDED.hostname, zenithjoy.agents.hostname),
           status       = 'online',
           last_seen    = now(),
           updated_at   = now()
     RETURNING id`,
    [params.tenantId, params.displayName, params.capabilities, params.version, hostname || null]
  );
  return {
    uuid: r.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000',
    displayName: params.displayName,
  };
}
