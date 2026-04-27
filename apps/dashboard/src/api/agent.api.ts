// apps/dashboard/src/api/agent.api.ts
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export interface AgentStatus {
  agentId: string;
  capabilities: string[];
  version: string;
  online: boolean;
  busy: boolean;
  lastHeartbeat: number;
}

export async function getAgentStatus(): Promise<{ agents: AgentStatus[] }> {
  const r = await fetch(`${API_BASE}/agent/status`);
  if (!r.ok) throw new Error('failed');
  return r.json();
}

export async function testPublish(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}
