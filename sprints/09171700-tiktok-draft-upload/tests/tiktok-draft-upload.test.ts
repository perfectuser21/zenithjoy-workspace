import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type TikTokIdempotencyStore,
  type TikTokPublishEnv,
} from '../../../apps/geoai/functions/api/tiktok/_lib';
import { onRequestPost as draftPost } from '../../../apps/geoai/functions/api/tiktok/draft';

const ACCESS_TOKEN = 'act.test-token-not-a-secret';
const API_KEY = 'internal-tiktok-publish-key';

function kv(): TikTokIdempotencyStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function env(extra: Partial<TikTokPublishEnv> = {}): TikTokPublishEnv {
  return {
    TIKTOK_ACCESS_TOKEN: ACCESS_TOKEN,
    TIKTOK_PUBLISH_API_KEY: API_KEY,
    TIKTOK_DRAFT_UPLOAD_ENABLED: 'false',
    ...extra,
  };
}

function request(body: unknown, apiKey = API_KEY): Request {
  return new Request('https://zenithjoyai.com/api/tiktok/draft', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({
    data,
    error: { code: 'ok', message: '', log_id: 'log-draft-1' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const base = {
  videoUrl: 'https://zenithjoyai.com/test-assets/tiktok-private-test.mp4',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/tiktok/draft', () => {
  it('defaults to preview and never calls TikTok', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await draftPost({ request: request(base), env: env() } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      mode: 'preview',
      request: {
        destination: 'TIKTOK_INBOX_DRAFT',
        videoUrl: base.videoUrl,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('requires the draft-upload gate and explicit confirmation', async () => {
    const response = await draftPost({
      request: request({
        ...base,
        mode: 'upload',
        confirm: 'UPLOAD_DRAFT',
        idempotencyKey: 'tiktok-draft-001',
      }),
      env: env({ TIKTOK_IDEMPOTENCY: kv() }),
    } as any);

    expect(response.status).toBe(403);
    expect((await response.json() as any).error).toBe('draft_upload_not_confirmed');
  });

  it('refuses a real upload without idempotency storage', async () => {
    const response = await draftPost({
      request: request({
        ...base,
        mode: 'upload',
        confirm: 'UPLOAD_DRAFT',
        idempotencyKey: 'tiktok-draft-001',
      }),
      env: env({ TIKTOK_DRAFT_UPLOAD_ENABLED: 'true' }),
    } as any);

    expect(response.status).toBe(503);
    expect((await response.json() as any).error).toBe('idempotency_store_not_configured');
  });

  it('initializes one inbox draft with PULL_FROM_URL and replays safely', async () => {
    const store = kv();
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/');
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(JSON.parse(String(init.body))).toEqual({
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: base.videoUrl,
        },
      });
      return ok({ publish_id: 'v_inbox_url~v2.123' });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const payload = {
      ...base,
      mode: 'upload',
      confirm: 'UPLOAD_DRAFT',
      idempotencyKey: 'tiktok-draft-001',
    };
    const enabled = env({
      TIKTOK_DRAFT_UPLOAD_ENABLED: 'true',
      TIKTOK_IDEMPOTENCY: store,
    });

    const first = await draftPost({ request: request(payload), env: enabled } as any);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      replayed: false,
      result: { publishId: 'v_inbox_url~v2.123' },
    });

    const replay = await draftPost({ request: request(payload), env: enabled } as any);
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody).toEqual({
      ok: true,
      replayed: true,
      result: { publishId: 'v_inbox_url~v2.123' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(replayBody)).not.toContain(ACCESS_TOKEN);
  });
});
