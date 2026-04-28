const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// 内部租户 ID（ZenithJoy内部，license ZJ-1F636A96）
export const INTERNAL_TENANT_ID = import.meta.env.VITE_TENANT_ID || '455a8ca9-5f63-4286-83ce-c5cca04cfd58';

export interface AgentStatus {
  agentId: string;
  capabilities: string[];
  version: string;
  online: boolean;
  busy: boolean;
  lastHeartbeat: number;
  connectedAt: number;
}

export interface AgentTask {
  id: string;
  tenantId: string;
  agentId: string | null;
  agentText: string | null;
  skill: string;
  params: Record<string, unknown>;
  status: 'pending' | 'running' | 'done' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export async function getAgentStatus(): Promise<{ agents: AgentStatus[] }> {
  const r = await fetch(`${API_BASE}/agent/status`);
  if (!r.ok) throw new Error('failed');
  return r.json();
}

export async function listTasks(): Promise<{ tasks: AgentTask[] }> {
  const r = await fetch(`${API_BASE}/agent/tasks?tenantId=${INTERNAL_TENANT_ID}`);
  if (!r.ok) throw new Error('failed');
  return r.json();
}

export async function createTask(skill: string, params: Record<string, unknown> = {}): Promise<{ task: AgentTask }> {
  const r = await fetch(`${API_BASE}/agent/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: INTERNAL_TENANT_ID, skill, params }),
  });
  if (!r.ok) throw new Error((await r.json()).error || 'failed');
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
