/**
 * 机器观测事件 API 客户端（Line02/Agent 观测 — 机器详情「模块与日志」块）
 *
 * 契约见 scratchpad/observability-contract.md：
 *   GET /api/agent/machines/:id/events?limit=50&kind=log|upgrade
 *   返回 { success, data: { logs:[...], upgrades:[...] } }
 *
 * 鉴权与 machines.api 同款：带 license token（若有）+ credentials:'include'。
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

/** 一条升级进度事件 */
export interface UpgradeEvent {
  id: string;
  module: string | null;
  phase: string | null;
  percent: number | null;
  message: string | null;
  created_at: string;
}

/** 一条日志/错误事件 */
export interface LogEvent {
  id: string;
  level: 'info' | 'warn' | 'error' | string | null;
  module: string | null;
  message: string | null;
  created_at: string;
}

export interface MachineEvents {
  logs: LogEvent[];
  upgrades: UpgradeEvent[];
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

/** 拉某机器最近观测事件（升级进度 + 日志/错误） */
export async function fetchMachineEvents(
  id: string,
  opts?: { limit?: number; kind?: 'log' | 'upgrade' }
): Promise<MachineEvents> {
  const qs = new URLSearchParams();
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.kind) qs.set('kind', opts.kind);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const r = await fetch(`${API_BASE}/agent/machines/${id}/events${suffix}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  const data = await parseEnvelope<Partial<MachineEvents>>(r);
  // 容错：后端字段缺失时给空数组，避免 UI 崩
  return {
    logs: Array.isArray(data?.logs) ? data.logs : [],
    upgrades: Array.isArray(data?.upgrades) ? data.upgrades : [],
  };
}
