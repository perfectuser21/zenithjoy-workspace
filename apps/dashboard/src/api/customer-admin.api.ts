/**
 * Line 10 客户管理后台 API 客户端
 *
 * 调 /api/tenant/* 后端（superAdminGuard，带 X-User-Email 头透传超管身份）：
 *   updateCompanyName   PUT    /api/tenant/:id
 *   listAccounts        GET    /api/tenant/:id/accounts
 *   createAccount       POST   /api/tenant/:id/accounts
 *   deleteAccount       DELETE /api/tenant/:id/accounts/:aid
 *   listServiceAgents   GET    /api/tenant/:id/service-agents
 *   bindDevice          POST   /api/tenant/:id/service-agents/:aid/bind-device
 *   deleteBinding       DELETE /api/tenant/:id/service-agents/:bid
 *
 * 诊断报告页复用既有 GET /api/agent/module-health（见 moduleHealth.api.ts）。
 */
import { adminFetch } from '../lib/admin-fetch';

export type SubAccountRole = 'admin' | 'operator' | 'service_agent';

export interface SubAccount {
  account_id: string;
  email: string;
  display_name: string;
  role: SubAccountRole;
  created_at: string;
}

export interface AccountsResponse {
  success: boolean;
  data: SubAccount[];
  total: number;
  quota: { used: number; limit: number };
}

export interface ServiceAgentBinding {
  binding_id: string;
  account_id: string;
  account_email: string;
  machine_id: string;
  hostname: string | null;
  online: boolean;
  bound_at: string;
}

export interface ServiceAgentsResponse {
  success: boolean;
  data: ServiceAgentBinding[];
  total: number;
}

export interface ApiError {
  code: string;
  message: string;
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: ApiError }).error;
    throw new Error(err?.message || `HTTP ${res.status}`);
  }
  return body as T;
}

export async function updateCompanyName(
  tenantId: string,
  name: string,
  email?: string
): Promise<{ tenant_id: string; name: string }> {
  const res = await adminFetch(`/api/tenant/${tenantId}`, email, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await parse<{ data: { tenant_id: string; name: string } }>(res);
  return body.data;
}

export async function listAccounts(tenantId: string, email?: string): Promise<AccountsResponse> {
  const res = await adminFetch(`/api/tenant/${tenantId}/accounts`, email);
  return parse<AccountsResponse>(res);
}

export async function createAccount(
  tenantId: string,
  input: { email: string; display_name: string; role: SubAccountRole },
  email?: string
): Promise<SubAccount> {
  const res = await adminFetch(`/api/tenant/${tenantId}/accounts`, email, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await parse<{ data: SubAccount }>(res);
  return body.data;
}

export async function deleteAccount(
  tenantId: string,
  accountId: string,
  email?: string
): Promise<void> {
  const res = await adminFetch(`/api/tenant/${tenantId}/accounts/${accountId}`, email, {
    method: 'DELETE',
  });
  await parse<unknown>(res);
}

export async function listServiceAgents(
  tenantId: string,
  email?: string
): Promise<ServiceAgentsResponse> {
  const res = await adminFetch(`/api/tenant/${tenantId}/service-agents`, email);
  return parse<ServiceAgentsResponse>(res);
}

export async function bindDevice(
  tenantId: string,
  accountId: string,
  machineId: string,
  email?: string
): Promise<{ binding_id: string }> {
  const res = await adminFetch(
    `/api/tenant/${tenantId}/service-agents/${accountId}/bind-device`,
    email,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine_id: machineId }),
    }
  );
  const body = await parse<{ data: { binding_id: string } }>(res);
  return body.data;
}

export async function deleteBinding(
  tenantId: string,
  bindingId: string,
  email?: string
): Promise<void> {
  const res = await adminFetch(`/api/tenant/${tenantId}/service-agents/${bindingId}`, email, {
    method: 'DELETE',
  });
  await parse<unknown>(res);
}
