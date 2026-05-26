/**
 * admin-fetch — 带 X-User-Email header 的 fetch 封装
 * 让 better-auth 邮箱登录用户的请求能通过 superAdminGuard
 */
export function adminFetch(url: string, email: string | undefined, init?: RequestInit): Promise<Response> {
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(email ? { 'X-User-Email': email } : {}),
  };
  return fetch(url, { ...init, credentials: 'include', headers });
}
