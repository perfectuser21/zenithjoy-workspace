/**
 * Sprint 06081603 ws-gamma — 模块健康看板 API 客户端
 *
 * 数据来源：GET /api/agent/module-health（beta 实现）
 * 返回每台已注册客户机器各 Line 模块的最新 preflight 状态。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * 读取当前 license token（与 walking-skeleton-1.api 同款）。
 * 端点 GET /api/agent/module-health 走 licenseAuth，需带 Authorization: Bearer <license>。
 */
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

/** 单个 Line 模块的 preflight 状态 */
export interface ModuleStatusEntry {
  ok: boolean;
  /** ok=false 时的失败原因（用户可读文字） */
  reason?: string;
}

/** 一台客户机器的模块健康快照 */
export interface AgentModuleHealth {
  agent_id: string;
  hostname: string;
  /** key 形如 line04-wechat-cs，value 为该模块状态 */
  module_status: Record<string, ModuleStatusEntry>;
  updated_at: string;
}

export interface ModuleHealthResponse {
  ok: boolean;
  data: AgentModuleHealth[];
}

export async function fetchModuleHealth(): Promise<ModuleHealthResponse> {
  const headers = new Headers();
  const lic = getLicenseToken();
  if (lic) headers.set('Authorization', `Bearer ${lic}`);
  const r = await fetch(`${API_BASE}/agent/module-health`, { headers });
  if (!r.ok) throw new Error('failed');
  return r.json();
}
