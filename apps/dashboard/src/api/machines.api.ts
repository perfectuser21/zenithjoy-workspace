/**
 * 机器管理 API 客户端（Line02 智能获客 — 机器管理页）
 *
 * 契约见 sprints/06260400-machine-management/contract.md：
 *   GET  /api/agent/machines       列出本租户机器
 *   GET  /api/agent/machines/:id   机器详情 + 抖音号列表
 *   PUT  /api/agent/machines/:id   改 nickname / machine_role
 *
 * 鉴权与 moduleHealth.api 同款：带 license token（若有）。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

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

function authHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const lic = getLicenseToken();
  if (lic) headers.set('Authorization', `Bearer ${lic}`);
  return headers;
}

/** 一台机器（列表 / 详情共用） */
export interface Machine {
  id: string;
  agent_id: string;
  hostname: string;
  nickname: string | null;
  machine_role: 'main' | 'sub';
  status: 'online' | 'offline';
  version: string;
  last_seen: string;
  session_count: number;
}

/** 机器下绑定的一个抖音号 */
export interface MachineSession {
  account_label: string;
  role: string;
  status: string;
  platform: string;
  account_nickname?: string;
  bound_at?: string;
}

export interface MachineDetail {
  machine: Machine;
  sessions: MachineSession[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function parseEnvelope<T>(r: Response): Promise<T> {
  let j: ApiEnvelope<T> | null = null;
  try {
    j = (await r.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`请求失败（${r.status}）`);
  }
  if (!r.ok || !j?.success) {
    throw new Error(j?.error?.message || `请求失败（${r.status}）`);
  }
  return j.data as T;
}

/** 列出本租户机器 */
export async function fetchMachines(): Promise<Machine[]> {
  const r = await fetch(`${API_BASE}/agent/machines`, { headers: authHeaders() });
  return parseEnvelope<Machine[]>(r);
}

/** 机器详情 + 抖音号列表 */
export async function fetchMachineDetail(id: string): Promise<MachineDetail> {
  const r = await fetch(`${API_BASE}/agent/machines/${id}`, { headers: authHeaders() });
  return parseEnvelope<MachineDetail>(r);
}

/** 更新机器（nickname / machine_role 至少一个） */
export async function updateMachine(
  id: string,
  patch: { nickname?: string; machine_role?: 'main' | 'sub' }
): Promise<Machine> {
  const r = await fetch(`${API_BASE}/agent/machines/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  return parseEnvelope<Machine>(r);
}

/**
 * 派 qr-bind 单（复用 DouyinBurnerBindPage 的派单逻辑）：在指定机器上弹独立 Chrome 扫码绑抖音号。
 * agent_id 指定到当前详情机器；后端按 agent_id 路由到那台机器执行。
 */
export async function dispatchQrBind(params: {
  account_label: string;
  agent_id: string;
}): Promise<{ task_id?: string }> {
  const r = await fetch(`${API_BASE}/agent/burner/qr-bind`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params),
  });
  return parseEnvelope<{ task_id?: string }>(r);
}
