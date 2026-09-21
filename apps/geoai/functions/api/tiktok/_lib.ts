/**
 * Shared primitives for TikTok private-publish and inbox-draft bridges.
 *
 * This module runs in Cloudflare Pages Functions. Keep it on Web Platform APIs
 * and never log or return access-token values.
 */

const TIKTOK_API_ORIGIN = 'https://open.tiktokapis.com';
const TIKTOK_TIMEOUT_MS = 15_000;

export interface TikTokIdempotencyStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface TikTokPublishEnv {
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_PUBLISH_API_KEY?: string;
  TIKTOK_PUBLISH_ENABLED?: string;
  TIKTOK_DRAFT_UPLOAD_ENABLED?: string;
  TIKTOK_MEDIA_HOSTS?: string;
  TIKTOK_IDEMPOTENCY?: TikTokIdempotencyStore;
}

export interface TikTokCreatorInfo {
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface TikTokErrorBody {
  code?: string;
  message?: string;
  log_id?: string;
  logid?: string;
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: TikTokErrorBody;
}

export type TikTokApiResult<T> =
  | { ok: true; status: number; data: T; logId?: string }
  | { ok: false; status: number; error: { code: string; message: string; logId?: string } };

export function missingTikTokPublishConfig(env: TikTokPublishEnv): string[] {
  const missing: string[] = [];
  if (!env?.TIKTOK_ACCESS_TOKEN) missing.push('TIKTOK_ACCESS_TOKEN');
  if (!env?.TIKTOK_PUBLISH_API_KEY) missing.push('TIKTOK_PUBLISH_API_KEY');
  return missing;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export function authenticateTikTokRequest(request: Request, env: TikTokPublishEnv): boolean {
  const configured = env?.TIKTOK_PUBLISH_API_KEY;
  if (!configured) return false;
  const raw = request.headers.get('Authorization') || '';
  if (!raw.startsWith('Bearer ')) return false;
  return timingSafeEqual(raw.slice('Bearer '.length), configured);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}

function safeTikTokError(status: number, envelope: TikTokEnvelope<unknown> | null) {
  const upstream = envelope?.error;
  const code = typeof upstream?.code === 'string' && upstream.code
    ? upstream.code
    : status >= 500
      ? 'upstream_error'
      : 'request_rejected';
  const logId = typeof upstream?.log_id === 'string'
    ? upstream.log_id
    : typeof upstream?.logid === 'string'
      ? upstream.logid
      : undefined;
  return {
    code,
    message: 'TikTok rejected the request.',
    ...(logId ? { logId } : {}),
  };
}

export async function tiktokRequest<T>(
  env: TikTokPublishEnv,
  path: string,
  body: Record<string, unknown> = {},
): Promise<TikTokApiResult<T>> {
  const token = env.TIKTOK_ACCESS_TOKEN;
  if (!token) {
    return {
      ok: false,
      status: 503,
      error: { code: 'not_configured', message: 'TikTok publishing is not configured.' },
    };
  }

  let response: Response;
  try {
    response = await fetch(`${TIKTOK_API_ORIGIN}/${path.replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      status: 502,
      error: { code: 'network_error', message: 'TikTok API could not be reached.' },
    };
  }

  let envelope: TikTokEnvelope<T> | null = null;
  try {
    envelope = await response.json() as TikTokEnvelope<T>;
  } catch {
    envelope = null;
  }
  const errorCode = envelope?.error?.code;
  if (!response.ok || errorCode !== 'ok' || envelope?.data === undefined) {
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      error: safeTikTokError(response.status, envelope),
    };
  }

  const logId = envelope.error?.log_id || envelope.error?.logid;
  return {
    ok: true,
    status: response.status,
    data: envelope.data,
    ...(logId ? { logId } : {}),
  };
}

export function isAllowedTikTokMediaUrl(value: string, env: TikTokPublishEnv): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const configured = (env.TIKTOK_MEDIA_HOSTS || 'zenithjoyai.com,www.zenithjoyai.com')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    return configured.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
