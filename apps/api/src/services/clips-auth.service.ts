import crypto from 'crypto';

const FEISHU_AUTHORIZE_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/access_token';
const FEISHU_REFRESH_URL = 'https://open.feishu.cn/open-apis/authen/v1/refresh_access_token';

export interface FeishuTokenResult {
  userToken: string;
  refreshToken: string;
  userId: string;
  userName: string;
  expiresAt: Date;
}

export function buildFeishuOAuthUrl(userId: string): string {
  const appId = process.env.FEISHU_APP_ID;
  const apiPublicUrl = process.env.API_PUBLIC_URL;
  if (!appId || !apiPublicUrl) throw new Error('FEISHU_APP_ID / API_PUBLIC_URL 未配置');

  const timestamp = Date.now();
  const secret = process.env.FEISHU_APP_SECRET || 'fallback';
  const state =
    crypto.createHmac('sha256', secret).update(`${userId}:${timestamp}`).digest('hex').slice(0, 16) +
    ':' +
    timestamp +
    ':' +
    userId;

  const redirectUri = `${apiPublicUrl}/api/clips/auth/feishu/callback`;
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'bitable:app');
  url.searchParams.set('state', state);
  return url.toString();
}

export function parseFeishuState(state: string): { userId: string; timestamp: number } | null {
  try {
    const parts = state.split(':');
    if (parts.length < 3) return null;
    const [, timestamp, userId] = parts;
    const ts = parseInt(timestamp, 10);
    if (Date.now() - ts > 10 * 60 * 1000) return null;
    return { userId, timestamp: ts };
  } catch {
    return null;
  }
}

export function parseFeishuTokenResponse(raw: Record<string, unknown>): FeishuTokenResult {
  return {
    userToken: raw.access_token as string,
    refreshToken: raw.refresh_token as string,
    userId: raw.open_id as string,
    userName: (raw.name || raw.en_name || '') as string,
    expiresAt: new Date(Date.now() + ((raw.expires_in as number) - 300) * 1000),
  };
}

export async function exchangeFeishuCode(code: string): Promise<FeishuTokenResult> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  const res = await fetch(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, app_id: appId, app_secret: appSecret }),
  });
  const json = (await res.json()) as { code: number; msg?: string; data: Record<string, unknown> };
  if (json.code !== 0) throw new Error(`Feishu token exchange failed: ${json.msg}`);
  return parseFeishuTokenResponse(json.data);
}

export async function refreshFeishuToken(refreshToken: string): Promise<FeishuTokenResult> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;
  const res = await fetch(FEISHU_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, app_id: appId, app_secret: appSecret }),
  });
  const json = (await res.json()) as { code: number; msg?: string; data: Record<string, unknown> };
  if (json.code !== 0) throw new Error(`Feishu token refresh failed: ${json.msg}`);
  return parseFeishuTokenResponse(json.data);
}

export async function validateNotionToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}
