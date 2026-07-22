const API_BASE = '/api/auth';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionResponse {
  user: AuthUser;
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
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getSession(): Promise<SessionResponse | null> {
  try {
    const data = await request<SessionResponse | null>('/get-session', { method: 'GET' });
    if (!data?.user) return null;
    return data;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await request('/sign-out', { method: 'POST' });
  } catch {
    // ignore
  }
}
