import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticateRequest,
  graphRequest,
  missingMetaConfig,
  type MetaEnv,
  type MetaIdempotencyStore,
} from '../../../apps/geoai/functions/api/meta/_lib';
import { onRequestGet as statusGet } from '../../../apps/geoai/functions/api/meta/status';
import { onRequestPost as publishPost } from '../../../apps/geoai/functions/api/meta/publish';

const TOKEN = 'test-page-token-not-a-secret';
const API_KEY = 'internal-publish-api-key';

function kv(initial: Record<string, string> = {}): MetaIdempotencyStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
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
      env: env({ META_PUBLISH_ENABLED: 'false', META_IDEMPOTENCY: kv() }),
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
    const store = kv();
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
    const store = kv();
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
    const store = kv();
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
