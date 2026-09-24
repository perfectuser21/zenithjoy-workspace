import { afterEach, describe, expect, it, vi } from 'vitest';

import type { D1Like, TikTokPublishEnv } from '../../../apps/geoai/functions/api/tiktok/_lib';
import { onRequestGet as creatorGet } from '../../../apps/geoai/functions/api/tiktok/creator';

const API_KEY = 'bridge-key';

/** D1 替身：creator 只探绑定存在与否；token 表读不到就退回 env 种子票。 */
const fakeD1 = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => null,
    }),
  }),
} as D1Like;

function env(extra: Partial<TikTokPublishEnv> = {}): TikTokPublishEnv {
  return {
    TIKTOK_ACCESS_TOKEN: 'act.token-not-a-secret',
    TIKTOK_PUBLISH_API_KEY: API_KEY,
    TIKTOK_PUBLISH_ENABLED: 'false',
    ...extra,
  } as TikTokPublishEnv;
}

function request(): Request {
  return new Request('https://zenithjoyai.com/api/tiktok/creator', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}

function creatorOk() {
  return new Response(
    JSON.stringify({
      data: {
        creator_username: 'zenithjoy',
        privacy_level_options: ['SELF_ONLY'],
        max_video_post_duration_sec: 600,
      },
      error: { code: 'ok', message: '', log_id: 'l' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/api/tiktok/creator 的幂等状态必须与实际发布路径一致', () => {
  it('只绑定 D1 时也要报 idempotencyConfigured=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => creatorOk()));
    const res = await creatorGet({
      request: request(),
      env: env({ TIKTOK_PUBLISH_DB: fakeD1 }),
    } as any);
    const body = (await res.json()) as any;
    // publish/draft 的 resolveTikTokStore 是 D1 优先；这里只看 KV 就会误报"没配"，
    // 诱使运维把无原子声明的 KV 加回来——那正是重复发帖的来源。
    expect(body.idempotencyConfigured).toBe(true);
    expect(body.idempotencyBackend).toBe('d1');
  });

  it('两者都没有时才报 false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => creatorOk()));
    const res = await creatorGet({ request: request(), env: env() } as any);
    const body = (await res.json()) as any;
    expect(body.idempotencyConfigured).toBe(false);
    expect(body.idempotencyBackend).toBe(null);
  });

  it('只绑定 KV（单测注入形态）报 true 且后端为 kv', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => creatorOk()));
    const kv = { get: async () => null, put: async () => {} } as any;
    const res = await creatorGet({
      request: request(),
      env: env({ TIKTOK_IDEMPOTENCY: kv }),
    } as any);
    const body = (await res.json()) as any;
    expect(body.idempotencyConfigured).toBe(true);
    expect(body.idempotencyBackend).toBe('kv');
  });

  it('D1 与 KV 并存时报 d1（与 resolveTikTokStore 的优先级一致）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => creatorOk()));
    const kv = { get: async () => null, put: async () => {} } as any;
    const res = await creatorGet({
      request: request(),
      env: env({ TIKTOK_PUBLISH_DB: fakeD1, TIKTOK_IDEMPOTENCY: kv }),
    } as any);
    expect(((await res.json()) as any).idempotencyBackend).toBe('d1');
  });
});
