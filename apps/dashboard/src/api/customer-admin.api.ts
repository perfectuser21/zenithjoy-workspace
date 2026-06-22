/**
 * Line 10 客户管理后台 API 客户端（#816 去重后：成员统一到 better-auth user + tenant_members）
 *
 * 调 /api/tenant/* 后端（superAdminGuard，带 X-User-Email 头透传超管身份）：
 *   updateCompanyName   PUT    /api/tenant/:id
 *   listMembers         GET    /api/tenant/:id/members
 *   addMemberByEmail    POST   /api/tenant/:id/members
 *   removeMember        DELETE /api/tenant/:id/members/:userId
 *   listServiceAgents   GET    /api/tenant/:id/service-agents
 *   bindDevice          POST   /api/tenant/:id/service-agents/:userId/bind-device
 *   deleteBinding       DELETE /api/tenant/:id/service-agents/:bid
 *
 * 诊断报告页复用既有 GET /api/agent/module-health（见 moduleHealth.api.ts）。
 */
import { adminFetch } from '../lib/admin-fetch';

export type MemberRole = 'owner' | 'admin' | 'member';

export interface TenantMember {
  user_id: string;
  email: string;
  name: string;
  role: MemberRole;
  joined_at: string;
}

export interface MembersResponse {
  success: boolean;
  data: TenantMember[];
  total: number;
}

export interface ServiceAgentBinding {
  binding_id: string;
  member_user_id: string;
  member_email: string | null;
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

export async function listMembers(tenantId: string, email?: string): Promise<MembersResponse> {
  const res = await adminFetch(`/api/tenant/${tenantId}/members`, email);
  return parse<MembersResponse>(res);
}

export async function addMemberByEmail(
  tenantId: string,
  memberEmail: string,
  role: MemberRole = 'member',
  email?: string
): Promise<{ user_id: string; email: string; role: MemberRole }> {
  const res = await adminFetch(`/api/tenant/${tenantId}/members`, email, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: memberEmail, role }),
  });
  const body = await parse<{ data: { user_id: string; email: string; role: MemberRole } }>(res);
  return body.data;
}

export async function removeMember(
  tenantId: string,
  userId: string,
  email?: string
): Promise<void> {
  const res = await adminFetch(`/api/tenant/${tenantId}/members/${userId}`, email, {
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
  memberUserId: string,
  machineId: string,
  email?: string
): Promise<{ binding_id: string }> {
  const res = await adminFetch(
    `/api/tenant/${tenantId}/service-agents/${memberUserId}/bind-device`,
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
