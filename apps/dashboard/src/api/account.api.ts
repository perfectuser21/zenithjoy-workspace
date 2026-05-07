/**
 * Account API client — Walking Skeleton #1
 *
 * GET /api/account/me — 当前 better-auth 登录用户拿自己的 free license
 * 鉴权：依赖 better-auth HTTP-only session cookie（credentials: 'include'）
 *
 * 401 / 网络错时：fetchAccountMe 把异常抛出去，调用方通过 useQuery 的 isError 处理。
 */

const API_BASE = '/api/account';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export interface AccountLicense {
  license_key: string;
  tier: 'free' | 'basic' | 'matrix' | 'studio' | 'enterprise';
  max_machines: number;
  expires_at: string;
}

export interface AccountMeResponse {
  user: AccountUser;
  license: AccountLicense | null;
}

export async function fetchAccountMe(): Promise<AccountMeResponse> {
  const res = await fetch(`${API_BASE}/me`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const json = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const errBody = (json as { error?: { message?: string } | string }).error;
    const msg =
      typeof errBody === 'string'
        ? errBody
        : errBody?.message || res.statusText;
    throw new Error(`HTTP_${res.status}: ${msg}`);
  }
  return json as AccountMeResponse;
}
