/**
 * Better-auth API client — Dashboard PR-3
 *
 * 直接 fetch + cookie（credentials: 'include'）调 backend better-auth 端点：
 *  - POST /api/auth/sign-up/email
 *  - POST /api/auth/sign-in/email
 *  - GET  /api/auth/get-session
 *  - POST /api/auth/request-password-reset
 *  - POST /api/auth/sign-out
 *
 * 设计：不依赖 better-auth React SDK，纯 fetch — 后端已经用 HTTP-only cookie session，
 * 前端只要 credentials: 'include' 就能透明带 session。
 */

const API_BASE = '/api/auth';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified?: boolean;
}

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  /** 可选：客户购买的 license_key（PR-2 之后会写入 tenant 关联） */
  license_key?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: AuthUser;
  token?: string;
}

export interface SessionResponse {
  user: AuthUser;
  session?: {
    id: string;
    userId: string;
    expiresAt?: string;
  };
}

export interface RequestPasswordResetInput {
  email: string;
  redirectTo: string;
}

export interface RequestPasswordResetResponse {
  status: boolean;
}

class AuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
    this.name = 'AuthError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  // better-auth 返回 JSON，错误时也是 JSON
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* ignore parse errors */
  }

  if (!res.ok) {
    const obj = (json && typeof json === 'object' ? (json as Record<string, unknown>) : {}) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    const code = obj.code || obj.error?.code || `HTTP_${res.status}`;
    const message = obj.message || obj.error?.message || res.statusText || '请求失败';
    throw new AuthError(code, message, res.status);
  }

  return json as T;
}

export async function signUpEmail(input: SignUpInput): Promise<AuthResult> {
  return request<AuthResult>('/sign-up/email', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function signInEmail(input: SignInInput): Promise<AuthResult> {
  return request<AuthResult>('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getSession(): Promise<SessionResponse | null> {
  try {
    const data = await request<SessionResponse | null>('/get-session', {
      method: 'GET',
    });
    // better-auth 在没 session 时返回 null（不是 401）
    if (!data || !data.user) return null;
    return data;
  } catch (err) {
    // 401 / 403 当作"无 session"处理
    if (err instanceof AuthError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export async function requestPasswordReset(
  input: RequestPasswordResetInput
): Promise<RequestPasswordResetResponse> {
  return request<RequestPasswordResetResponse>('/request-password-reset', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function signOut(): Promise<{ success: boolean }> {
  try {
    await request<{ success: boolean }>('/sign-out', { method: 'POST' });
    return { success: true };
  } catch {
    return { success: false };
  }
}
