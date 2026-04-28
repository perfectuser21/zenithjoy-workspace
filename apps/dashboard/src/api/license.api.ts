/**
 * License API client — Sprint A Day 3
 *
 * 通过 /api/admin/license/* 调用后端：
 *  - fetchMyLicense  当前飞书登录用户自查
 *  - listAllLicenses super-admin 列表
 *  - createLicense   super-admin 创建
 *  - revokeLicense   super-admin 吊销
 *
 * 所有请求自动注入 X-Feishu-User-Id 头（来自 AuthContext token/cookie 已有的 user.id）。
 */

export type Tier = 'basic' | 'matrix' | 'studio' | 'enterprise';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'suspended';

export interface LicenseRow {
  id: string;
  license_key: string;
  tier: Tier;
  max_machines: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: LicenseStatus;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MachineRow {
  id: string;
  license_id: string;
  machine_id: string;
  agent_id: string | null;
  hostname: string | null;
  first_seen: string;
  last_seen: string;
  status: string;
}

export interface MyLicenseResponse {
  license: LicenseRow | null;
  machines: MachineRow[];
}

export interface ListLicensesResponse {
  licenses: LicenseRow[];
  total: number;
}

export interface CreateLicenseInput {
  tier: Tier;
  customer_name?: string;
  customer_email?: string;
  customer_id?: string;
  duration_days?: number;
  notes?: string;
}

const API_BASE = '/api/admin/license';

function getFeishuUserId(): string {
  // 优先 cookie 'user'，fallback localStorage（迁移期）
  const cookieMatch =
    typeof document !== 'undefined'
      ? document.cookie.match(/(^|; )user=([^;]+)/)
      : null;
  if (cookieMatch) {
    try {
      const u = JSON.parse(decodeURIComponent(cookieMatch[2]));
      return u.feishu_user_id || u.id || '';
    } catch {
      /* fall through */
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

async function request<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  const fid = getFeishuUserId();
  if (fid) headers.set('X-Feishu-User-Id', fid);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (json && json.error && json.error.code) || `HTTP_${res.status}`;
    const message = (json && json.error && json.error.message) || res.statusText;
    const err = new Error(`${code}: ${message}`) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return (json && json.data) as T;
}

export async function fetchMyLicense(): Promise<MyLicenseResponse> {
  return request<MyLicenseResponse>(`${API_BASE}/me`);
}

export async function listAllLicenses(): Promise<ListLicensesResponse> {
  return request<ListLicensesResponse>(`${API_BASE}`);
}

export async function createLicense(
  input: CreateLicenseInput
): Promise<LicenseRow> {
  return request<LicenseRow>(`${API_BASE}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeLicense(id: string): Promise<LicenseRow> {
  return request<LicenseRow>(`${API_BASE}/${id}`, { method: 'DELETE' });
}
