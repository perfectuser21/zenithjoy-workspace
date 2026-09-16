/**
 * Shared primitives for the Zenithjoy Meta publishing bridge.
 *
 * Cloudflare Pages Functions run in the Workers runtime. Keep this module on
 * Web Platform APIs only and never log or return access-token values.
 */

const GRAPH_HOST = 'https://graph.facebook.com';
const GRAPH_TIMEOUT_MS = 15_000;

/**
 * 幂等声明存储。
 *
 * ⚠️ 这里刻意**不是**一个 KV 接口。发布是不可逆的对外动作，防重复必须依赖
 * **原子声明**（claim），而 Cloudflare KV 给不了：
 *   1. KV 没有 compare-and-set，`get` 后再 `put` 之间存在 TOCTOU 窗口，
 *      两个并发请求会双双读到 null、双双写 pending、双双发帖；
 *   2. KV 是最终一致，写入全球传播可达 60s，即使请求不并发、只是落在不同
 *      边缘节点，也可能都读不到刚写的值。
 * Cloudflare 官方亦说明 KV 不适合用于协调/加锁。
 *
 * 因此本接口要求实现方提供 `claim()` 语义：对同一 key 只有第一个调用者拿到
 * `claimed: true`，后续调用者拿到 `claimed: false` 与已存在的记录。
 * 生产实现见 `d1IdempotencyStore()`（D1 主键约束保证原子性）。
 */
export interface StoredAttemptRecord {
  /** instagram_container_created = 容器已建但尚未 publish，重试时必须复用容器而非重建。 */
  state: 'pending' | 'instagram_container_created' | 'succeeded';
  fingerprint: string;
  createdAt: string;
  containerId?: string;
  result?: { id: string };
}

export interface MetaIdempotencyStore {
  /**
   * 原子地尝试声明一个 key。
   * - 首次声明成功 → `{ claimed: true }`
   * - key 已存在   → `{ claimed: false, existing }`（existing 为当前记录）
   */
  claim(key: string, attempt: StoredAttemptRecord): Promise<
    { claimed: true } | { claimed: false; existing: StoredAttemptRecord }
  >;
  /** 读取当前记录（无则 null）。 */
  read(key: string): Promise<StoredAttemptRecord | null>;
  /** 覆盖写入已声明 key 的状态（推进 pending → container → succeeded）。 */
  update(key: string, attempt: StoredAttemptRecord): Promise<void>;
}

/** D1 绑定的最小结构（避免依赖 @cloudflare/workers-types）。 */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta?: { changes?: number } }>;
      first<T = unknown>(): Promise<T | null>;
    };
  };
}

/**
 * 基于 D1 的幂等存储。原子性来自 `idempotency_key` 的主键约束：
 * `INSERT ... ON CONFLICT DO NOTHING` 在冲突时 changes=0，
 * 由数据库保证同一 key 只有一个调用者能插入成功。
 *
 * 建表见 sprints/09161245-meta-publishing/schema.sql
 */
export function d1IdempotencyStore(db: D1Like): MetaIdempotencyStore {
  const rowToAttempt = (row: Record<string, unknown> | null): StoredAttemptRecord | null => {
    if (!row) return null;
    const result = typeof row.result === 'string' && row.result
      ? (JSON.parse(row.result) as { id: string })
      : undefined;
    const state = row.state === 'succeeded'
      ? 'succeeded'
      : row.state === 'instagram_container_created'
        ? 'instagram_container_created'
        : 'pending';
    return {
      state,
      fingerprint: String(row.fingerprint ?? ''),
      createdAt: String(row.created_at ?? ''),
      ...(row.container_id ? { containerId: String(row.container_id) } : {}),
      ...(result ? { result } : {}),
    };
  };

  const read = async (key: string): Promise<StoredAttemptRecord | null> => {
    const row = await db
      .prepare('SELECT state, fingerprint, created_at, container_id, result FROM meta_publish_attempts WHERE idempotency_key = ?')
      .bind(key)
      .first<Record<string, unknown>>();
    return rowToAttempt(row);
  };

  return {
    read,
    async claim(key, attempt) {
      const res = await db
        .prepare(
          `INSERT INTO meta_publish_attempts
             (idempotency_key, state, fingerprint, created_at, container_id, result)
           VALUES (?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(idempotency_key) DO NOTHING`,
        )
        .bind(key, attempt.state, attempt.fingerprint, attempt.createdAt)
        .run();
      if (res?.meta?.changes === 1) return { claimed: true };
      const existing = await read(key);
      // 极罕见：插入冲突但随即被清理。视作本次未抢到，交由调用方按冲突处理。
      return {
        claimed: false,
        existing: existing ?? { ...attempt, fingerprint: 'unknown' },
      };
    },
    async update(key, attempt) {
      await db
        .prepare(
          `UPDATE meta_publish_attempts
              SET state = ?, result = ?, container_id = ?, fingerprint = ?
            WHERE idempotency_key = ?`,
        )
        .bind(
          attempt.state,
          attempt.result ? JSON.stringify(attempt.result) : null,
          attempt.containerId ?? null,
          attempt.fingerprint,
          key,
        )
        .run();
    },
  };
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
  /** D1 绑定：发布幂等的强一致存储（KV 不足以防重复，见 MetaIdempotencyStore 注释）。 */
  META_PUBLISH_DB?: D1Like;
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
