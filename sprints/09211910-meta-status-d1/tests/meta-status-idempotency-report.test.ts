import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MetaEnv } from '../../../apps/geoai/functions/api/meta/_lib';
import { onRequestGet as statusGet } from '../../../apps/geoai/functions/api/meta/status';

const API_KEY = 'internal-meta-status-key';
const PAGE_ID = '1377853155400886';
const IG_ID = '17841431871959485';

function env(extra: Partial<MetaEnv> = {}): MetaEnv {
  return {
    META_GRAPH_API_VERSION: 'v26.0',
    META_PAGE_ID: PAGE_ID,
    META_INSTAGRAM_BUSINESS_ACCOUNT_ID: IG_ID,
    META_PAGE_ACCESS_TOKEN: 'page-token-not-a-secret',
    META_PUBLISH_API_KEY: API_KEY,
    META_PUBLISH_ENABLED: 'false',
    ...extra,
  } as MetaEnv;
}

function request(): Request {
  return new Request('https://zenithjoyai.com/api/meta/status', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}

/** D1 替身：status 只探绑定存在与否，不会发 SQL。 */
const fakeD1 = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
    }),
  }),
} as any;

function graphOk() {
  return new Response(
    JSON.stringify({
      id: PAGE_ID,
      name: 'Zenithjoy',
      instagram_business_account: { id: IG_ID, username: 'zenithjoycloud' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/meta/status 的幂等状态必须与实际发布路径一致', () => {
  it('只绑定 D1 时也要报 idempotencyConfigured=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphOk()));
    const res = await statusGet({
      request: request(),
      env: env({ META_PUBLISH_DB: fakeD1 }),
    } as any);
    const body = (await res.json()) as any;
    // publish.ts 的 resolveStore 是 D1 优先，status 若只看 KV 就会误报"没配"，
    // 诱使运维把不安全的 KV 加回来。
    expect(body.idempotencyConfigured).toBe(true);
  });

  it('两者都没有时才报 false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphOk()));
    const res = await statusGet({ request: request(), env: env() } as any);
    const body = (await res.json()) as any;
    expect(body.idempotencyConfigured).toBe(false);
  });

  it('只绑定 KV（单测注入形态）仍报 true，且标明后端类型', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphOk()));
    const kv = { claim: async () => ({ claimed: true }), read: async () => null, update: async () => {} } as any;
    const res = await statusGet({
      request: request(),
      env: env({ META_IDEMPOTENCY: kv }),
    } as any);
    const body = (await res.json()) as any;
    expect(body.idempotencyConfigured).toBe(true);
    expect(body.idempotencyBackend).toBe('kv');
  });

  it('D1 与 KV 同时存在时，后端应报 d1（与 resolveStore 的优先级一致）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => graphOk()));
    const kv = { claim: async () => ({ claimed: true }), read: async () => null, update: async () => {} } as any;
    const res = await statusGet({
      request: request(),
      env: env({ META_PUBLISH_DB: fakeD1, META_IDEMPOTENCY: kv }),
    } as any);
    const body = (await res.json()) as any;
    expect(body.idempotencyBackend).toBe('d1');
  });
});
