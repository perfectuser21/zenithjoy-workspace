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

/**
 * 发布尝试的持久化记录。`operation` 区分 publish / draft——两者共用调用方传来的
 * idempotencyKey 是合法的，必须靠 operation 隔离，否则草稿会把私密发布误判成重放。
 */
export type TikTokOperation = 'publish' | 'draft';

export interface TikTokAttemptRecord {
  state: 'pending' | 'initialized';
  fingerprint: string;
  createdAt: string;
  publishId?: string;
}

/**
 * 原子声明式幂等存储。
 *
 * 为什么不能用 KV：KV 只有 get / put，没有条件写。`先 get 再 put` 之间存在窗口，
 * 两个并发请求会同时读到空、同时往下走，最终各自调一次 TikTok 发布接口 = 重复发帖。
 * D1 的主键约束让 `INSERT ... ON CONFLICT DO NOTHING` 成为一次原子操作：
 * 只有 changes===1 的那个调用者拿到 claimed:true，其余一律 claimed:false。
 */
export interface TikTokClaimStore {
  claim(
    operation: TikTokOperation,
    key: string,
    attempt: TikTokAttemptRecord,
  ): Promise<{ claimed: true } | { claimed: false; existing: TikTokAttemptRecord }>;
  read(operation: TikTokOperation, key: string): Promise<TikTokAttemptRecord | null>;
  update(operation: TikTokOperation, key: string, attempt: TikTokAttemptRecord): Promise<void>;
}

export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
}

export function d1TikTokIdempotencyStore(db: D1Like): TikTokClaimStore {
  const rowToAttempt = (row: Record<string, unknown> | null): TikTokAttemptRecord | null => {
    if (!row) return null;
    return {
      state: row.state === 'initialized' ? 'initialized' : 'pending',
      fingerprint: String(row.fingerprint ?? ''),
      createdAt: String(row.created_at ?? ''),
      ...(row.publish_id ? { publishId: String(row.publish_id) } : {}),
    };
  };

  const read = async (
    operation: TikTokOperation,
    key: string,
  ): Promise<TikTokAttemptRecord | null> => {
    const row = await db
      .prepare(
        'SELECT state, fingerprint, created_at, publish_id FROM tiktok_publish_attempts WHERE operation = ? AND idempotency_key = ?',
      )
      .bind(operation, key)
      .first<Record<string, unknown>>();
    return rowToAttempt(row);
  };

  return {
    read,
    async claim(operation, key, attempt) {
      const res = await db
        .prepare(
          `INSERT INTO tiktok_publish_attempts
             (operation, idempotency_key, state, fingerprint, created_at, publish_id)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(operation, idempotency_key) DO NOTHING`,
        )
        .bind(operation, key, attempt.state, attempt.fingerprint, attempt.createdAt)
        .run();
      if (res?.meta?.changes === 1) return { claimed: true };
      const existing = await read(operation, key);
      // 理论上声明失败必然读得到记录；读不到说明记录刚被清理，
      // 用一个不可能匹配的 fingerprint 让调用方走冲突分支，绝不放行发布。
      return { claimed: false, existing: existing ?? { ...attempt, fingerprint: 'unknown' } };
    },
    async update(operation, key, attempt) {
      await db
        .prepare(
          `UPDATE tiktok_publish_attempts
              SET state = ?, fingerprint = ?, created_at = ?, publish_id = ?
            WHERE operation = ? AND idempotency_key = ?`,
        )
        .bind(
          attempt.state,
          attempt.fingerprint,
          attempt.createdAt,
          attempt.publishId ?? null,
          operation,
          key,
        )
        .run();
    },
  };
}

export interface TikTokPublishEnv {
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_PUBLISH_API_KEY?: string;
  TIKTOK_PUBLISH_ENABLED?: string;
  TIKTOK_DRAFT_UPLOAD_ENABLED?: string;
  TIKTOK_MEDIA_HOSTS?: string;
  /** 生产幂等存储：D1 原子声明。 */
  TIKTOK_PUBLISH_DB?: D1Like;
  /** KV 形态，仅供单测注入；无原子声明，不得作为生产实现。 */
  TIKTOK_IDEMPOTENCY?: TikTokIdempotencyStore;
}


const PENDING_TTL_SECONDS = 24 * 60 * 60;
const INITIALIZED_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 把仅供单测注入的 KV 形态包装成 claim 接口。
 *
 * ⚠️ 这里的 claim 是「先读再写」，**没有原子性**——它只用于单测。
 * 生产路径必须走 D1（见 resolveStore），否则并发会重复发帖。
 */
export function kvClaimStore(store: TikTokIdempotencyStore): TikTokClaimStore {
  const k = (operation: string, key: string) => `tiktok-${operation}:${key}`;
  const read = async (operation: TikTokOperation, key: string) => {
    const raw = await store.get(k(operation, key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TikTokAttemptRecord;
    } catch {
      return { state: 'pending', fingerprint: 'corrupt', createdAt: new Date().toISOString() } as TikTokAttemptRecord;
    }
  };
  const write = async (operation: TikTokOperation, key: string, attempt: TikTokAttemptRecord, ttl: number) => {
    await store.put(k(operation, key), JSON.stringify(attempt), { expirationTtl: ttl });
  };
  return {
    read,
    async claim(operation, key, attempt) {
      const existing = await read(operation, key);
      if (existing) return { claimed: false, existing };
      await write(operation, key, attempt, PENDING_TTL_SECONDS);
      return { claimed: true };
    },
    async update(operation, key, attempt) {
      await write(operation, key, attempt, INITIALIZED_TTL_SECONDS);
    },
  };
}

export function resolveTikTokStore(env: TikTokPublishEnv): TikTokClaimStore | null {
  // D1 优先：只有它能提供原子声明。KV 形态仅供单测注入。
  if (env.TIKTOK_PUBLISH_DB) return d1TikTokIdempotencyStore(env.TIKTOK_PUBLISH_DB);
  if (env.TIKTOK_IDEMPOTENCY) return kvClaimStore(env.TIKTOK_IDEMPOTENCY);
  return null;
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
