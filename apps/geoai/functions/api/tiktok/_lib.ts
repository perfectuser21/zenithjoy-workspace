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
  /** 种子令牌：D1 里还没有记录时用它初始化，之后以 D1 为准。 */
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_REFRESH_TOKEN?: string;
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
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

const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
/** 提前 5 分钟视为过期，避免请求正好卡在到期瞬间。 */
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

async function readTokens(db: D1Like): Promise<StoredTokens | null> {
  const row = await db
    .prepare('SELECT access_token, refresh_token, expires_at FROM tiktok_oauth_tokens WHERE id = ?')
    .bind('default')
    .first<Record<string, unknown>>();
  if (!row?.access_token || !row?.refresh_token) return null;
  return {
    accessToken: String(row.access_token),
    refreshToken: String(row.refresh_token),
    expiresAt: String(row.expires_at ?? ''),
  };
}

async function writeTokens(db: D1Like, t: StoredTokens): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tiktok_oauth_tokens (id, access_token, refresh_token, expires_at, updated_at)
       VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(t.accessToken, t.refreshToken, t.expiresAt, new Date().toISOString())
    .run();
}

function isExpired(expiresAt: string): boolean {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return true;
  return at - TOKEN_EXPIRY_SKEW_MS <= Date.now();
}

/**
 * 用 refresh_token 换一对新令牌。
 *
 * TikTok 会**轮换** refresh_token：响应里带回的那个才是下次能用的。
 * 不回写就等于把下一次刷新的钥匙丢了，届时只能人工重新授权。
 */
async function refreshTokens(env: TikTokPublishEnv, refreshToken: string): Promise<StoredTokens> {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    throw new Error('tiktok_refresh_not_configured');
  }
  const res = await fetch(TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
  });
  let body: Record<string, unknown> | null = null;
  try { body = await res.json() as Record<string, unknown>; } catch { body = null; }
  const accessToken = typeof body?.access_token === 'string' ? body.access_token : '';
  if (!res.ok || !accessToken) {
    // 刷新失败必须如实抛出：把旧票当成可用会让调用方以为通道健康，
    // 直到真正发布时才炸，那时已分不清是内容问题还是鉴权问题。
    throw new Error('tiktok_token_refresh_failed');
  }
  const expiresIn = typeof body?.expires_in === 'number' ? body.expires_in : 86_400;
  return {
    accessToken,
    refreshToken: typeof body?.refresh_token === 'string' && body.refresh_token
      ? body.refresh_token
      : refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

/**
 * 取一个当下可用的 access token。
 *
 * 顺序：D1 记录 → 没有则用 env 种子落库 → 过期则刷新并回写。
 * access token 只活 24 小时，没有这一步就得每天人工重新授权。
 */
export async function resolveTikTokAccessToken(env: TikTokPublishEnv): Promise<string> {
  const db = env.TIKTOK_PUBLISH_DB;

  // 读不到就当"还没有记录"。表可能尚未建好（部署与建表之间有窗口），
  // 这种时候应退回 env 里的种子票继续服务，而不是让整条发布链 503。
  let stored: StoredTokens | null = null;
  if (db) {
    try { stored = await readTokens(db); } catch { stored = null; }
  }

  if (stored) {
    if (!isExpired(stored.expiresAt)) return stored.accessToken;
    // 有记录且已过期：必须换票。换不到就如实抛错，不拿旧票冒充可用。
    const fresh = await refreshTokens(env, stored.refreshToken);
    try { await writeTokens(db!, fresh); } catch { /* 落库失败不影响本次调用 */ }
    return fresh.accessToken;
  }

  if (!env.TIKTOK_ACCESS_TOKEN) throw new Error('tiktok_access_token_missing');
  // 有 refresh token 才值得落库——否则存了也刷不了，反而让后续误以为具备刷新能力。
  if (db && env.TIKTOK_REFRESH_TOKEN) {
    try {
      await writeTokens(db, {
        accessToken: env.TIKTOK_ACCESS_TOKEN,
        refreshToken: env.TIKTOK_REFRESH_TOKEN,
        // 种子票真实到期时间未知，先按 24 小时用；真失效由 401 重试路径兜底。
        expiresAt: new Date(Date.now() + 86_400 * 1000).toISOString(),
      });
    } catch { /* 表未就绪，本次仍用种子票 */ }
  }
  return env.TIKTOK_ACCESS_TOKEN;
}

/** 上游明确说票无效时强制刷新一次（不看本地过期时间）。 */
async function forceRefresh(env: TikTokPublishEnv): Promise<string | null> {
  const db = env.TIKTOK_PUBLISH_DB;
  if (!db) return null;
  const tokens = await readTokens(db);
  const refreshToken = tokens?.refreshToken || env.TIKTOK_REFRESH_TOKEN;
  if (!refreshToken) return null;
  try {
    const fresh = await refreshTokens(env, refreshToken);
    await writeTokens(db, fresh);
    return fresh.accessToken;
  } catch {
    return null;
  }
}

export async function tiktokRequest<T>(
  env: TikTokPublishEnv,
  path: string,
  body: Record<string, unknown> = {},
): Promise<TikTokApiResult<T>> {
  let token: string;
  try {
    token = await resolveTikTokAccessToken(env);
  } catch {
    return {
      ok: false,
      status: 503,
      error: { code: 'not_configured', message: 'TikTok publishing is not configured.' },
    };
  }

  const call = async (bearer: string): Promise<Response | null> => {
    try {
      return await fetch(`${TIKTOK_API_ORIGIN}/${path.replace(/^\/+/, '')}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  };
  const parse = async (r: Response): Promise<TikTokEnvelope<T> | null> => {
    try { return await r.json() as TikTokEnvelope<T>; } catch { return null; }
  };

  let response = await call(token);
  if (!response) {
    return {
      ok: false,
      status: 502,
      error: { code: 'network_error', message: 'TikTok API could not be reached.' },
    };
  }
  let envelope = await parse(response);

  // 本地以为票没过期、上游却说无效（被提前吊销或时钟偏差）。
  // 强制刷新后只重试一次，避免刷新本身有问题时打成循环。
  if (envelope?.error?.code === 'access_token_invalid') {
    const fresh = await forceRefresh(env);
    if (fresh && fresh !== token) {
      token = fresh;
      const retry = await call(fresh);
      if (!retry) {
        return {
          ok: false,
          status: 502,
          error: { code: 'network_error', message: 'TikTok API could not be reached.' },
        };
      }
      response = retry;
      envelope = await parse(retry);
    }
  }

  const errorCode = envelope?.error?.code;
  if (!response.ok || errorCode !== 'ok' || envelope?.data === undefined) {
    return {
      ok: false,
      status: response.status >= 400 ? response.status : 502,
      error: {
        code: errorCode || 'tiktok_error',
        message: 'TikTok rejected the request.',
        logId: envelope?.error?.log_id || envelope?.error?.logid || null,
      },
    };
  }
  return { ok: true, status: response.status, data: envelope.data as T };
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
