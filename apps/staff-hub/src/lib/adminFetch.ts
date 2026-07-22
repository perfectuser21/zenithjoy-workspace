export function adminFetch(url: string, email: string | undefined, init?: RequestInit): Promise<Response> {
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(email ? { 'X-User-Email': email } : {}),
  };
  return fetch(url, { ...init, credentials: 'include', headers });
}
