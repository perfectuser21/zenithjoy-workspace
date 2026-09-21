import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  d1TikTokIdempotencyStore,
  kvClaimStore,
  type D1Like,
  type TikTokIdempotencyStore,
  type TikTokPublishEnv,
} from '../../../apps/geoai/functions/api/tiktok/_lib';
import { onRequestPost as publishPost } from '../../../apps/geoai/functions/api/tiktok/publish';
import { onRequestPost as draftPost } from '../../../apps/geoai/functions/api/tiktok/draft';

const ACCESS_TOKEN = 'act.test-token-not-a-secret';
const API_KEY = 'internal-tiktok-publish-key';

/**
 * 栅栏：前 n-1 个到达者挂起，第 n 个到达时一起放行。
 *
 * 用它把「两个请求同时越过读取阶段」这件事变成确定性的，而不是靠事件循环
 * 恰好这么调度。没有栅栏的并发测试会随实现细节时红时绿，等于没有守卫。
 */
function barrier(n: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return async () => {
    arrived += 1;
    if (arrived >= n) release();
    await gate;
  };
}

/**
 * D1 替身：只实现本 store 用到的三条 SQL，忠实模拟
 * `INSERT ... ON CONFLICT(operation, idempotency_key) DO NOTHING`——
 * 命中主键返回 changes:0。栅栏放在 INSERT 之前，模拟两个请求同时抵达；
 * 放行后的检查与写入是同步的，等价于主键约束的原子判定。
 */
function fakeD1(onInsert?: () => Promise<void>): D1Like {
  const rows = new Map<string, Record<string, unknown>>();
  const pk = (op: unknown, key: unknown) => `${String(op)}::${String(key)}`;
  return {
    prepare(query: string) {
      return {
        bind(...v: unknown[]) {
          return {
            async run() {
              if (query.includes('INSERT INTO tiktok_publish_attempts')) {
                if (onInsert) await onInsert();
                const [operation, key, state, fingerprint, createdAt] = v;
                const id = pk(operation, key);
                if (rows.has(id)) return { meta: { changes: 0 } };
                rows.set(id, {
                  operation, idempotency_key: key, state,
                  fingerprint, created_at: createdAt, publish_id: null,
                });
                return { meta: { changes: 1 } };
              }
              if (query.includes('UPDATE tiktok_publish_attempts')) {
                const [state, fingerprint, createdAt, publishId, operation, key] = v;
                const id = pk(operation, key);
                if (!rows.has(id)) return { meta: { changes: 0 } };
                rows.set(id, {
                  ...rows.get(id)!, state, fingerprint,
                  created_at: createdAt, publish_id: publishId,
                });
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected SQL: ${query}`);
            },
            async first<T>() {
              if (query.includes('SELECT state, fingerprint, created_at, publish_id')) {
                const [operation, key] = v;
                return (rows.get(pk(operation, key)) ?? null) as T | null;
              }
              throw new Error(`unexpected SQL: ${query}`);
            },
          };
        },
      };
    },
  };
}

/** KV 形态：get 之后才 put，两者之间没有互斥。栅栏放在 get 上。 */
function fakeKv(onGet?: () => Promise<void>): TikTokIdempotencyStore {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => {
      if (onGet) await onGet();
      return values.get(key) ?? null;
    },
    put: async (key: string, value: string) => { values.set(key, value); },
  };
}

const ATTEMPT = { state: 'pending' as const, fingerprint: 'fp-1', createdAt: '2026-09-21T00:00:00Z' };

describe('幂等存储层：并发声明只能有一个赢家', () => {
  it('D1 原子声明：两个同时到达的 claim，只有一个拿到 claimed=true', async () => {
    const gate = barrier(2);
    const store = d1TikTokIdempotencyStore(fakeD1(gate));
    const [a, b] = await Promise.all([
      store.claim('publish', 'tk-same-1', ATTEMPT),
      store.claim('publish', 'tk-same-1', ATTEMPT),
    ]);
    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
  });

  it('KV 形态在同样条件下会放行两个赢家——这正是它不能用于生产的原因', async () => {
    const gate = barrier(2);
    const store = kvClaimStore(fakeKv(gate));
    const [a, b] = await Promise.all([
      store.claim('publish', 'tk-same-2', ATTEMPT),
      store.claim('publish', 'tk-same-2', ATTEMPT),
    ]);
    // 固化这个事实：两个都 claimed=true，等于两次真实发布。
    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(2);
  });

  it('operation 参与主键：publish 与 draft 用同一个 key 互不遮蔽', async () => {
    const store = d1TikTokIdempotencyStore(fakeD1());
    const first = await store.claim('publish', 'tk-shr-3', ATTEMPT);
    const second = await store.claim('draft', 'tk-shr-3', ATTEMPT);
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);
    const again = await store.claim('publish', 'tk-shr-3', ATTEMPT);
    expect(again.claimed).toBe(false);
  });
});

// ── 端到端：并发打到真实端点，断言上游只被调用一次 ──────────────────

function env(extra: Partial<TikTokPublishEnv> = {}): TikTokPublishEnv {
  return {
    TIKTOK_ACCESS_TOKEN: ACCESS_TOKEN,
    TIKTOK_PUBLISH_API_KEY: API_KEY,
    TIKTOK_PUBLISH_ENABLED: 'true',
    TIKTOK_DRAFT_UPLOAD_ENABLED: 'true',
    TIKTOK_MEDIA_HOSTS: 'zenithjoyai.com',
    ...extra,
  } as TikTokPublishEnv;
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://zenithjoyai.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
}

function graphOk(data: unknown): Response {
  return new Response(
    JSON.stringify({ data, error: { code: 'ok', message: '', log_id: 'log-1' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function upstream() {
  const calls = { creator: 0, init: 0, inbox: 0 };
  const fetchSpy = vi.fn(async (url: string) => {
    if (String(url).includes('creator_info/query')) {
      calls.creator += 1;
      return graphOk({
        creator_username: 'zenithjoy',
        privacy_level_options: ['SELF_ONLY'],
        max_video_post_duration_sec: 600,
      });
    }
    if (String(url).includes('/inbox/video/init/')) {
      calls.inbox += 1;
      return graphOk({ publish_id: `v_inbox~${calls.inbox}` });
    }
    if (String(url).includes('/video/init/')) {
      calls.init += 1;
      return graphOk({ publish_id: `v_pub_url~${calls.init}` });
    }
    throw new Error(`unexpected upstream call: ${url}`);
  });
  return { calls, fetchSpy };
}

const publishBody = {
  videoUrl: 'https://zenithjoyai.com/test-assets/tiktok-private-test.mp4',
  durationSeconds: 4,
  title: 'ZenithJoy concurrency probe',
  isAigc: false,
  promotesOwnBrand: true,
  paidPartnership: false,
  mode: 'publish',
  confirm: 'PUBLISH_PRIVATE',
  idempotencyKey: 'tk-pub-01',
};

const draftBody = {
  videoUrl: 'https://zenithjoyai.com/test-assets/tiktok-private-test.mp4',
  mode: 'upload',
  confirm: 'UPLOAD_DRAFT',
  idempotencyKey: 'tk-drf-01',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('端点并发：TikTok 上游只能被调用一次', () => {
  it('两个同时到达的 publish 只调一次 TikTok init', async () => {
    const { calls, fetchSpy } = upstream();
    vi.stubGlobal('fetch', fetchSpy);
    const e = env({ TIKTOK_PUBLISH_DB: fakeD1(barrier(2)) });
    const [a, b] = await Promise.all([
      publishPost({ request: jsonRequest('/api/tiktok/publish', publishBody), env: e } as any),
      publishPost({ request: jsonRequest('/api/tiktok/publish', publishBody), env: e } as any),
    ]);
    expect(calls.init).toBe(1);
    const bodies = (await Promise.all([a.json(), b.json()])) as any[];
    expect(bodies.filter((x) => x.ok === true && x.replayed === false)).toHaveLength(1);
  });

  it('两个同时到达的 draft 只调一次 TikTok inbox init', async () => {
    const { calls, fetchSpy } = upstream();
    vi.stubGlobal('fetch', fetchSpy);
    const e = env({ TIKTOK_PUBLISH_DB: fakeD1(barrier(2)) });
    const [a, b] = await Promise.all([
      draftPost({ request: jsonRequest('/api/tiktok/draft', draftBody), env: e } as any),
      draftPost({ request: jsonRequest('/api/tiktok/draft', draftBody), env: e } as any),
    ]);
    expect(calls.inbox).toBe(1);
    const bodies = (await Promise.all([a.json(), b.json()])) as any[];
    expect(bodies.filter((x) => x.ok === true && x.replayed === false)).toHaveLength(1);
  });
});
