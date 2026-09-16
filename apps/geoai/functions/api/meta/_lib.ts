/**
 * Shared primitives for the Zenithjoy Meta publishing bridge.
 *
 * Cloudflare Pages Functions run in the Workers runtime. Keep this module on
 * Web Platform APIs only and never log or return access-token values.
 */

const GRAPH_HOST = 'https://graph.facebook.com';
const GRAPH_TIMEOUT_MS = 15_000;

export interface MetaIdempotencyStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
export interface MetaEnv {
  META_GRAPH_API_VERSION?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_PAGE_ID?: string;
  META_INSTAGRAM_BUSINESS_ACCOUNT_ID?: string;
  META_PAGE_ACCESS_TOKEN?: string;
  META_PUBLISH_API_KEY?: string;
  META_PUBLISH_ENABLED?: string;
  META_IDEMPOTENCY?: MetaIdempotencyStore;
}

export interface GraphError {
  code: string | number;
  type?: string;
  subcode?: number;
  message: string;
}

export type GraphResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: GraphError };

export function missingMetaConfig(env: MetaEnv): string[] {
  const missing: string[] = [];
  if (!env?.META_GRAPH_API_VERSION) missing.push('META_GRAPH_API_VERSION');
  if (!env?.META_PAGE_ID) missing.push('META_PAGE_ID');
  if (!env?.META_INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    missing.push('META_INSTAGRAM_BUSINESS_ACCOUNT_ID');
  }
  if (!env?.META_PAGE_ACCESS_TOKEN) missing.push('META_PAGE_ACCESS_TOKEN');
  if (!env?.META_PUBLISH_API_KEY) missing.push('META_PUBLISH_API_KEY');
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

export function authenticateRequest(request: Request, env: MetaEnv): boolean {
  const configured = env?.META_PUBLISH_API_KEY;
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

function safeGraphError(status: number, body: unknown): GraphError {
  const fallback: GraphError = {
    code: status || 'graph_error',
    message: 'Meta Graph API rejected the request.',
  };
  if (!body || typeof body !== 'object') return fallback;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') return fallback;
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === 'number' || typeof value.code === 'string'
      ? value.code
      : fallback.code,
    type: typeof value.type === 'string' ? value.type : undefined,
    subcode: typeof value.error_subcode === 'number' ? value.error_subcode : undefined,
    // Do not forward Meta's raw message: upstream messages can contain request details.
    message: fallback.message,
  };
}

function graphVersion(env: MetaEnv): string | null {
  const value = env.META_GRAPH_API_VERSION || '';
  return /^v\d+\.\d+$/.test(value) ? value : null;
}

export async function graphRequest<T>(
  env: MetaEnv,
  path: string,
  options: {
    method?: 'GET' | 'POST';
    params?: Record<string, string>;
  } = {},
): Promise<GraphResult<T>> {
  const version = graphVersion(env);
  const token = env.META_PAGE_ACCESS_TOKEN;
  if (!version || !token) {
    return {
      ok: false,
      status: 503,
      error: { code: 'not_configured', message: 'Meta publishing is not configured.' },
    };
  }

  const method = options.method || 'GET';
  const cleanPath = path.replace(/^\/+/, '');
  const url = new URL(`${GRAPH_HOST}/${version}/${cleanPath}`);
  const params = new URLSearchParams(options.params || {});
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  };
  if (method === 'GET') {
    url.search = params.toString();
  } else {
    (init.headers as Record<string, string>)['Content-Type'] =
      'application/x-www-form-urlencoded';
    init.body = params.toString();
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), init);
  } catch {
    return {
      ok: false,
      status: 502,
      error: {
        code: 'network_error',
        message: 'Meta Graph API could not be reached.',
      },
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const hasGraphError = Boolean(
    body && typeof body === 'object' && (body as Record<string, unknown>).error,
  );
  if (!response.ok || hasGraphError) {
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      error: safeGraphError(response.status, body),
    };
  }
  return { ok: true, status: response.status, data: body as T };
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

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
