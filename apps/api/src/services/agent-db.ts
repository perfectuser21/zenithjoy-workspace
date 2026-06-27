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
 * 而在 agents 表裂成多行。这里在 upsert 前先按 (tenant_id, hostname) 探测：
 *   - hostname 非空且已有同 (tenant_id, hostname) 行 → 复用/UPDATE 那行（不因 agent_id 不同新增行）
 *   - 否则退回原 agent_id 唯一约束 upsert（INSERT ... ON CONFLICT(agent_id)）
 * 不破坏现有 agent_id UNIQUE 约束；DB 层另有 partial unique index (tenant_id, hostname) 兜底（见 migration）。
 *
 * @returns 收敛后的 agents.id（UUID）；hostname 空时返回 null（旧调用方不取返回值）
 */
async function findDedupRowByHostname(
  tenantId: string,
  hostname: string,
): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    `SELECT id
       FROM zenithjoy.agents
      WHERE tenant_id = $1 AND hostname = $2 AND hostname IS NOT NULL AND hostname <> ''
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, hostname],
  );
  return r.rows[0]?.id ?? null;
}

export async function upsertAgent(p: UpsertAgentParams): Promise<void> {
  const hostname = typeof p.hostname === 'string' ? p.hostname.trim() : '';

  if (hostname) {
    const existingId = await findDedupRowByHostname(p.tenantId, hostname);
    if (existingId) {
      // 命中同机器去重行 → UPDATE 复用（agent_id 收敛为本次上报值，保持稳定单行）
      await pool.query(
        `UPDATE zenithjoy.agents
            SET agent_id     = $2,
                capabilities = $3,
                version      = $4,
                status       = 'online',
                last_seen    = now(),
                updated_at   = now()
          WHERE id = $1`,
        [existingId, p.agentId, p.capabilities, p.version],
      );
      return;
    }
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
  // 身份统一：hostname 非空且已有同 (tenant_id, hostname) 行 → 复用那行（不因 displayName 不同新增）
  const hostname = typeof params.hostname === 'string' ? params.hostname.trim() : '';
  if (hostname && params.tenantId) {
    const existingId = await findDedupRowByHostname(params.tenantId, hostname);
    if (existingId) {
      const upd = await pool.query<{ id: string }>(
        `UPDATE zenithjoy.agents
            SET agent_id     = $2,
                capabilities = $3,
                version      = $4,
                status       = 'online',
                last_seen    = now(),
                updated_at   = now()
          WHERE id = $1
          RETURNING id`,
        [existingId, params.displayName, params.capabilities, params.version],
      );
      return {
        uuid: upd.rows[0]?.id ?? existingId,
        displayName: params.displayName,
      };
    }
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
