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
