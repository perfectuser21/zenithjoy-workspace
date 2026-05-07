/**
 * Walking Skeleton #1 — 客户首次成功路径（抖音版）API client
 * Contract: docs/walking-skeleton-1-contract.md 第 2 节
 *
 * Endpoints in contract（api-impl 实现）:
 *  - POST /api/agent/heartbeat
 *  - POST /api/agent/folder/bind
 *  - POST /api/publish/task
 *  - POST /api/publish/receipt        (Agent only — 不被 dashboard 调用)
 *  - GET  /api/publish/tasks/:id
 *
 * 假定的额外 endpoint（dashboard 用，已 SendMessage team-lead 确认协调）：
 *  - GET  /api/agent/me/status         → 当前 license 下 agent 在线状态（客户视角）
 *  - POST /api/agent/qr-bind           → 推 qr_bind/<platform> task 给 agent
 *  - GET  /api/agent/platforms         → 列 agent_platform_sessions
 *  - GET  /api/publish/tasks?agent_id  → 列出 publish_tasks
 */

const API_BASE = '/api';

function getLicenseToken(): string {
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(^|; )license=([^;]+)/);
    if (m) return decodeURIComponent(m[2]);
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('zj_license') || '';
  }
  return '';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const lic = getLicenseToken();
  if (lic && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${lic}`);
  }
  const res = await fetch(`${API_BASE}${url}`, { ...init, headers });
  const json = await res
    .json()
    .catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const errBody = (json as { error?: { message?: string } | string }).error;
    const msg =
      typeof errBody === 'string'
        ? errBody
        : errBody?.message || res.statusText;
    throw new Error(`HTTP_${res.status}: ${msg}`);
  }
  return json as T;
}

// ============ Types ============

export interface AgentHeartbeatBody {
  license: string;
  version: string;
  hostname: string;
}
export interface AgentHeartbeatResponse {
  ok: boolean;
  agent_id: string;
  queued_tasks: Array<{ id: string; type: string; payload: Record<string, unknown> }>;
}

export interface AgentStatus {
  connected: boolean;
  agent_id: string | null;
  hostname: string | null;
  version: string | null;
  last_heartbeat_at: string | null;
  bound_folder_path?: string | null;
}

export interface FolderBindBody {
  agent_id: string;
  local_path: string;
}
export interface OkResponse {
  ok: true;
}

export interface PublishTaskBody {
  agent_id: string;
  platform: string;
  folder_path: string;
}
export interface PublishTaskResponse {
  task_id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface PublishTaskDetail {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  result: { url?: string; error?: string; dryrun_evidence?: unknown } | null;
  created_at: string;
  receipt_at: string | null;
}

export interface PlatformSessionStatus {
  platform: string;
  account_label: string;
  status: 'pending' | 'active' | 'expired';
  bound_at: string | null;
}

// ============ Endpoints ============

export async function postAgentHeartbeat(
  body: AgentHeartbeatBody
): Promise<AgentHeartbeatResponse> {
  return request<AgentHeartbeatResponse>('/agent/heartbeat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getAgentStatus(): Promise<AgentStatus> {
  return request<AgentStatus>('/agent/me/status');
}

export async function postFolderBind(body: FolderBindBody): Promise<OkResponse> {
  return request<OkResponse>('/agent/folder/bind', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function postPublishTask(
  body: PublishTaskBody
): Promise<PublishTaskResponse> {
  return request<PublishTaskResponse>('/publish/task', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getPublishTask(id: string): Promise<PublishTaskDetail> {
  return request<PublishTaskDetail>(`/publish/tasks/${id}`);
}

export async function listPublishTasks(
  agentId: string
): Promise<{ tasks: PublishTaskDetail[] }> {
  return request<{ tasks: PublishTaskDetail[] }>(
    `/publish/tasks?agent_id=${encodeURIComponent(agentId)}`
  );
}

export async function postQrBind(
  agentId: string,
  platform: string
): Promise<OkResponse> {
  return request<OkResponse>('/agent/qr-bind', {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId, platform }),
  });
}

export async function getPlatformSessions(
  agentId: string
): Promise<{ sessions: PlatformSessionStatus[] }> {
  return request<{ sessions: PlatformSessionStatus[] }>(
    `/agent/platforms?agent_id=${encodeURIComponent(agentId)}`
  );
}
