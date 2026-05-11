import pool from '../db/connection';

export interface UpsertAgentParams {
  tenantId: string;
  agentId: string;
  capabilities: string[];
  version: string;
  platform?: string;
  hostname?: string;
}

export async function upsertAgent(p: UpsertAgentParams): Promise<void> {
  await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, status, last_seen)
     VALUES ($1, $2, $3, $4, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id    = EXCLUDED.tenant_id,
           capabilities = EXCLUDED.capabilities,
           version      = EXCLUDED.version,
           status       = 'online',
           last_seen    = now(),
           updated_at   = now()`,
    [p.tenantId, p.agentId, p.capabilities, p.version]
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
}

export interface FindOrCreateAgentUuidResult {
  uuid: string;                // = agents.id
  displayName: string;         // 入参回显
}

export async function findOrCreateAgentUuid(
  params: FindOrCreateAgentUuidParams
): Promise<FindOrCreateAgentUuidResult> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, capabilities, version, status, last_seen)
     VALUES ($1, $2, $3, $4, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id    = COALESCE(EXCLUDED.tenant_id, zenithjoy.agents.tenant_id),
           capabilities = EXCLUDED.capabilities,
           version      = EXCLUDED.version,
           status       = 'online',
           last_seen    = now(),
           updated_at   = now()
     RETURNING id`,
    [params.tenantId, params.displayName, params.capabilities, params.version]
  );
  return {
    uuid: r.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000',
    displayName: params.displayName,
  };
}
