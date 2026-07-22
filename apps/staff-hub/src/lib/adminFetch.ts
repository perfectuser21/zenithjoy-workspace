export interface AdminFetchIdentity {
  email?: string;
  feishu_user_id?: string;
}

export function adminFetch(
  url: string,
  identity: string | AdminFetchIdentity | undefined | null,
  init?: RequestInit
): Promise<Response> {
  const email = typeof identity === 'string' ? identity : identity?.email;
  const feishuUserId = typeof identity === 'string' ? undefined : identity?.feishu_user_id;
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(email ? { 'X-User-Email': email } : {}),
    ...(feishuUserId ? { 'X-Feishu-User-Id': feishuUserId } : {}),
  };
  return fetch(url, { ...init, credentials: 'include', headers });
}
