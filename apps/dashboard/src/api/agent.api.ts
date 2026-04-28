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

export async function testPublishDouyin(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-douyin`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishKuaishou(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-kuaishou`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishXiaohongshu(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-xiaohongshu`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishToutiao(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-toutiao`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishWeibo(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-weibo`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishShipinhao(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-shipinhao`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}

export async function testPublishZhihu(): Promise<{ ok: boolean; taskId: string; agentId: string }> {
  const r = await fetch(`${API_BASE}/agent/test-publish-zhihu`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json()).error);
  return r.json();
}
