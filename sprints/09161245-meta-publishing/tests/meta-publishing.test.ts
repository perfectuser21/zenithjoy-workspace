import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticateRequest,
  graphRequest,
  missingMetaConfig,
  type MetaEnv,
  type MetaIdempotencyStore,
  type StoredAttemptRecord,
} from '../../../apps/geoai/functions/api/meta/_lib';
import { onRequestGet as statusGet } from '../../../apps/geoai/functions/api/meta/status';
import { onRequestPost as publishPost } from '../../../apps/geoai/functions/api/meta/publish';

const TOKEN = 'test-page-token-not-a-secret';
const API_KEY = 'internal-publish-api-key';

/**
 * 内存版幂等存储，模拟 D1 的**原子声明**语义：
 * 同一 key 只有第一个 claim 返回 claimed:true。
 * 注意这里刻意不模拟 KV —— KV 的 get-then-put 无法防重复（见 _lib.ts 注释）。
 */
function memStore(
  initial: Record<string, StoredAttemptRecord> = {},
): MetaIdempotencyStore & { values: Map<string, StoredAttemptRecord> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    read: vi.fn(async (key: string) => values.get(key) ?? null),
    claim: vi.fn(async (key: string, attempt: StoredAttemptRecord) => {
      const existing = values.get(key);
      if (existing) return { claimed: false as const, existing };
      values.set(key, attempt);
      return { claimed: true as const };
    }),
    update: vi.fn(async (key: string, attempt: StoredAttemptRecord) => {
      values.set(key, attempt);
    }),
  };
}

function env(extra: Partial<MetaEnv> = {}): MetaEnv {
  return {
    META_GRAPH_API_VERSION: 'v24.0',
    META_PAGE_ID: '61594139321850',
    META_INSTAGRAM_BUSINESS_ACCOUNT_ID: '17841400000000000',
    META_PAGE_ACCESS_TOKEN: TOKEN,
    META_PUBLISH_API_KEY: API_KEY,
    META_PUBLISH_ENABLED: 'false',
    ...extra,
  };
}

function request(
  url: string,
  init: RequestInit = {},
  apiKey: string | undefined = API_KEY,
): Request {
  const headers = new Headers(init.headers);
  if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
  return new Request(url, { ...init, headers });
}

function jsonRequest(body: unknown, apiKey: string | undefined = API_KEY): Request {
  return request(
    'https://www.zenithjoyai.com/api/meta/publish',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    apiKey,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Meta config and endpoint authentication', () => {
  it('reports missing names without returning any secret values', () => {
    expect(missingMetaConfig({})).toEqual([
      'META_GRAPH_API_VERSION',
      'META_PAGE_ID',
      'META_INSTAGRAM_BUSINESS_ACCOUNT_ID',
      'META_PAGE_ACCESS_TOKEN',
      'META_PUBLISH_API_KEY',
    ]);
  });

  it('rejects a missing or wrong bearer key', () => {
    expect(authenticateRequest(request('https://example.com', {}, ''), env())).toBe(false);
    expect(authenticateRequest(request('https://example.com', {}, 'wrong'), env())).toBe(false);
    expect(authenticateRequest(request('https://example.com'), env())).toBe(true);
  });
});

describe('Graph API transport', () => {
  it('sends the Page token only in Authorization and never in the URL', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).not.toContain(TOKEN);
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
      return new Response(JSON.stringify({ id: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await graphRequest(env(), '/me', { method: 'GET' });
    expect(result.ok).toBe(true);
  });
});

describe('GET /api/meta/status', () => {
  it('requires the internal API key', async () => {
    const response = await statusGet({
      request: request('https://www.zenithjoyai.com/api/meta/status', {}, ''),
      env: env(),
    } as any);
    expect(response.status).toBe(401);
  });

  it('verifies the configured Page and linked Instagram account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: '61594139321850',
            name: 'Zenithjoy',
            instagram_business_account: {
              id: '17841400000000000',
              username: 'zenithjoy',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const response = await statusGet({
      request: request('https://www.zenithjoyai.com/api/meta/status'),
      env: env(),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.ok).toBe(true);
    expect(body.assets.page.name).toBe('Zenithjoy');
    expect(body.assets.instagram.username).toBe('zenithjoy');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('fails closed when the linked Instagram ID differs from configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: '61594139321850',
            name: 'Zenithjoy',
            instagram_business_account: { id: 'unexpected-id', username: 'wrong' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const response = await statusGet({
      request: request('https://www.zenithjoyai.com/api/meta/status'),
      env: env(),
    } as any);
    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.error).toBe('asset_mismatch');
  });
});

describe('POST /api/meta/publish', () => {
  it('defaults to preview and performs zero Graph writes', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await publishPost({
      request: jsonRequest({ platform: 'facebook', message: 'Hello' }),
      env: env(),
    } as any);
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await response.json() as any).mode).toBe('preview');
  });

  it('requires both the server switch and explicit PUBLISH confirmation', async () => {
    const response = await publishPost({
      request: jsonRequest({
        platform: 'facebook',
        message: 'Hello',
        mode: 'publish',
        confirm: 'PUBLISH',
        idempotencyKey: 'post-001',
      }),
      env: env({ META_PUBLISH_ENABLED: 'false', META_IDEMPOTENCY: memStore() }),
    } as any);
    expect(response.status).toBe(403);
  });

  it('refuses live publishing without durable idempotency storage', async () => {
    const response = await publishPost({
      request: jsonRequest({
        platform: 'facebook',
        message: 'Hello',
        mode: 'publish',
        confirm: 'PUBLISH',
        idempotencyKey: 'post-001',
      }),
      env: env({ META_PUBLISH_ENABLED: 'true' }),
    } as any);
    expect(response.status).toBe(503);
  });

  it('publishes a Facebook Page text post once and stores the result', async () => {
    const store = memStore();
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain('/61594139321850/feed');
      expect(init.method).toBe('POST');
      expect(String(init.body)).toContain('message=Hello');
      return new Response(JSON.stringify({ id: 'page_post_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const body = {
      platform: 'facebook',
      message: 'Hello',
      mode: 'publish',
      confirm: 'PUBLISH',
      idempotencyKey: 'post-001',
    };
    const response = await publishPost({
      request: jsonRequest(body),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    } as any);
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await response.json() as any).result.id).toBe('page_post_123');

    const replay = await publishPost({
      request: jsonRequest(body),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    } as any);
    expect(replay.status).toBe(200);
    expect((await replay.json() as any).replayed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('publishes an Instagram image in create then media_publish steps', async () => {
    const store = memStore();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'container_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'ig_media_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await publishPost({
      request: jsonRequest({
        platform: 'instagram',
        caption: 'New product',
        mediaUrl: 'https://cdn.example.com/product.jpg',
        mode: 'publish',
        confirm: 'PUBLISH',
        idempotencyKey: 'ig-post-001',
      }),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    } as any);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/17841400000000000/media');
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/17841400000000000/media_publish');
    expect((await response.json() as any).result.id).toBe('ig_media_123');
  });

  it('keeps an ambiguous failed publish locked to prevent blind duplicates', async () => {
    const store = memStore();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connection reset'); }));

    const payload = {
      platform: 'facebook',
      message: 'Do not duplicate',
      mode: 'publish',
      confirm: 'PUBLISH',
      idempotencyKey: 'ambiguous-001',
    };
    const first = await publishPost({
      request: jsonRequest(payload),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    } as any);
    expect(first.status).toBe(502);

    const second = await publishPost({
      request: jsonRequest(payload),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    } as any);
    expect(second.status).toBe(409);
  });

  it('rejects non-HTTPS media URLs before any Graph call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await publishPost({
      request: jsonRequest({
        platform: 'instagram',
        caption: 'bad url',
        mediaUrl: 'http://example.com/image.jpg',
      }),
      env: env(),
    } as any);
    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('幂等：并发竞态（本次改动的核心）', () => {
  it('同一 idempotencyKey 并发两次，只发布一次', async () => {
    const store = memStore();
    let graphCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      graphCalls += 1;
      return new Response(JSON.stringify({ id: 'fb-post-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const mkReq = () => new Request('https://www.zenithjoyai.com/api/meta/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        platform: 'facebook',
        message: 'concurrent test',
        mode: 'publish',
        confirm: 'PUBLISH',
        idempotencyKey: 'race-001',
      }),
    });
    const e = env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store });

    const [a, b] = await Promise.all([
      publishPost({ request: mkReq(), env: e }),
      publishPost({ request: mkReq(), env: e }),
    ]);

    // 核心断言：Graph API 只被调用一次，绝不重复发帖
    expect(graphCalls).toBe(1);

    // 断言真实不变量，而非某个特定交错顺序：
    //   两请求的合法结局有二 —— 后者读到已成功记录做 replay(200)，
    //   或后者撞上 pending 被要求人工复核(409)。两种都不会二次发帖。
    const bodies = await Promise.all([a.json(), b.json()] as Promise<any>[]);
    const publishedOnce = bodies.filter((x) => x.ok && !x.replayed).length;
    expect(publishedOnce).toBe(1);            // 有且仅有一次真实发布
    for (const [i, res] of [a, b].entries()) {
      const body = bodies[i];
      if (res.status === 200) {
        // 200 必须要么是那次真实发布，要么明确标记为 replay
        expect(body.ok).toBe(true);
        expect(body.result?.id).toBe('fb-post-1');
      } else {
        expect(res.status).toBe(409);
        expect(body.error).toBe('publish_outcome_requires_review');
      }
    }
    vi.unstubAllGlobals();
  });

  it('未抢到声明的请求返回 publish_outcome_requires_review，不盲目重试', async () => {
    const store = memStore({
      'race-002': {
        state: 'pending',
        fingerprint: 'whatever',
        createdAt: new Date().toISOString(),
      },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const res = await publishPost({
      request: new Request('https://www.zenithjoyai.com/api/meta/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          platform: 'facebook',
          message: 'x',
          mode: 'publish',
        confirm: 'PUBLISH',
          idempotencyKey: 'race-002',
        }),
      }),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    });

    expect(res.status).toBe(409);
    // 关键：不得因为"上次状态不明"就再打一次 Graph API
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('claim 失败时不泄露 token', async () => {
    const store = memStore({
      'race-003': { state: 'pending', fingerprint: 'f', createdAt: new Date().toISOString() },
    });
    const res = await publishPost({
      request: new Request('https://www.zenithjoyai.com/api/meta/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          platform: 'facebook', message: 'x', mode: 'publish',
        confirm: 'PUBLISH', idempotencyKey: 'race-003',
        }),
      }),
      env: env({ META_PUBLISH_ENABLED: 'true', META_IDEMPOTENCY: store }),
    });
    const body = await res.text();
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain(API_KEY);
  });
});
