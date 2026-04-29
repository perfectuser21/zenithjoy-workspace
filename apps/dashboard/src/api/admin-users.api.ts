/**
 * Admin Users API client — PR-A 超管会员管理
 *
 * 调用 /api/admin/users/* 后端：
 *  - listUsers           列出 better-auth 用户 + 各自 tenants
 *  - addUserToTenant     拉用户进 tenant
 *  - removeUserFromTenant 把用户从 tenant 踢出
 *  - deleteUser          删除用户
 *
 * 鉴权依赖 superAdminGuard：注入 X-Feishu-User-Id 头（同 license.api 模式），
 * 同时 credentials: 'include' 让 better-auth session cookie 透传。
 */

export type TenantRole = 'owner' | 'admin' | 'member';

export interface UserTenantRow {
  tenant_id: string;
  name: string;
  plan: string;
  role: TenantRole;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
  tenants: UserTenantRow[];
}

export interface ListUsersResponse {
  users: UserRow[];
  total: number;
}

export interface ListUsersInput {
  q?: string;
  limit?: number;
  offset?: number;
}

export interface AddUserToTenantInput {
  tenant_id: string;
  role?: TenantRole;
}

export interface AddUserToTenantResponse {
  tenants: UserTenantRow[];
}

const API_BASE = '/api/admin/users';

function getFeishuUserId(): string {
  const cookieMatch =
    typeof document !== 'undefined'
      ? document.cookie.match(/(^|; )user=([^;]+)/)
      : null;
  if (cookieMatch) {
    try {
      const u = JSON.parse(decodeURIComponent(cookieMatch[2]));
      return u.feishu_user_id || u.id || '';
    } catch {
      /* ignore */
    }
  }
  if (typeof localStorage !== 'undefined') {
    const ls = localStorage.getItem('user');
    if (ls) {
      try {
        const u = JSON.parse(ls);
        return u.feishu_user_id || u.id || '';
      } catch {
        /* ignore */
      }
    }
  }
  return '';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const fid = getFeishuUserId();
  if (fid) headers.set('X-Feishu-User-Id', fid);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (json && json.error && json.error.code) || `HTTP_${res.status}`;
    const message =
      (json && json.error && json.error.message) || res.statusText;
    const err = new Error(`${code}: ${message}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return (json && json.data) as T;
}

export async function listUsers(
  input: ListUsersInput = {}
): Promise<ListUsersResponse> {
  const params = new URLSearchParams();
  if (input.q) params.set('q', input.q);
  if (input.limit !== undefined) params.set('limit', String(input.limit));
  if (input.offset !== undefined) params.set('offset', String(input.offset));
  const qs = params.toString();
  return request<ListUsersResponse>(`${API_BASE}${qs ? `?${qs}` : ''}`);
}

export async function addUserToTenant(
  userId: string,
  input: AddUserToTenantInput
): Promise<AddUserToTenantResponse> {
  return request<AddUserToTenantResponse>(
    `${API_BASE}/${encodeURIComponent(userId)}/tenant-members`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function removeUserFromTenant(
  userId: string,
  tenantId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `${API_BASE}/${encodeURIComponent(userId)}/tenant-members/${encodeURIComponent(tenantId)}`,
    { method: 'DELETE' }
  );
}

export async function deleteUser(
  userId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `${API_BASE}/${encodeURIComponent(userId)}`,
    { method: 'DELETE' }
  );
}
