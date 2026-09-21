import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  authenticateTikTokRequest,
  missingTikTokPublishConfig,
  tiktokRequest,
  type TikTokIdempotencyStore,
  type TikTokPublishEnv,
} from '../../../apps/geoai/functions/api/tiktok/_lib';
import { onRequestGet as creatorGet } from '../../../apps/geoai/functions/api/tiktok/creator';
import { onRequestPost as publishPost } from '../../../apps/geoai/functions/api/tiktok/publish';
import { onRequestPost as statusPost } from '../../../apps/geoai/functions/api/tiktok/status';

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
    TIKTOK_PUBLISH_ENABLED: 'false',
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
    'https://zenithjoyai.com/api/tiktok/publish',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    apiKey,
  );
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: { code: 'ok', message: '', log_id: 'log-1' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TikTok config and transport', () => {
  it('reports only missing variable names', () => {
    expect(missingTikTokPublishConfig({})).toEqual([
      'TIKTOK_ACCESS_TOKEN',
      'TIKTOK_PUBLISH_API_KEY',
    ]);
  });

  it('requires the internal bearer key', () => {
    expect(authenticateTikTokRequest(request('https://example.com', {}, ''), env())).toBe(false);
    expect(authenticateTikTokRequest(request('https://example.com', {}, 'wrong'), env())).toBe(false);
    expect(authenticateTikTokRequest(request('https://example.com'), env())).toBe(true);
  });

  it('sends the TikTok token only in Authorization', async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).not.toContain(ACCESS_TOKEN);
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      return ok({ creator_username: 'zenithjoy' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    expect((await tiktokRequest(env(), '/v2/post/publish/creator_info/query/')).ok).toBe(true);
  });

  it('treats a TikTok body error as failure even when HTTP is 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {},
      error: { code: 'scope_not_authorized', message: 'raw upstream detail' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const result = await tiktokRequest(env(), '/v2/post/publish/creator_info/query/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('scope_not_authorized');
      expect(result.error.message).not.toContain('raw upstream detail');
    }
  });
});

describe('GET /api/tiktok/creator', () => {
  it('returns the current creator and allowed privacy options without exposing tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      creator_username: 'zenithjoy',
      creator_nickname: 'ZenithJoy',
      privacy_level_options: ['SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: true,
      max_video_post_duration_sec: 60,
    })));
    const response = await creatorGet({
      request: request('https://zenithjoyai.com/api/tiktok/creator'),
      env: env(),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.creator.username).toBe('zenithjoy');
    expect(body.creator.privacyLevelOptions).toEqual(['SELF_ONLY']);
    expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
  });
});

describe('POST /api/tiktok/publish', () => {
  const base = {
    videoUrl: 'https://zenithjoyai.com/test-assets/tiktok-private-test.mp4',
    durationSeconds: 4,
    title: 'ZenithJoy private integration test',
    isAigc: false,
    promotesOwnBrand: true,
    paidPartnership: false,
  };

  it('defaults to preview and makes no TikTok request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await publishPost({ request: jsonRequest(base), env: env() } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.mode).toBe('preview');
    expect(body.request.privacyLevel).toBe('SELF_ONLY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects media outside the verified ZenithJoy host', async () => {
    const response = await publishPost({
      request: jsonRequest({ ...base, videoUrl: 'https://example.com/video.mp4' }),
      env: env(),
    } as any);
    expect(response.status).toBe(400);
    expect((await response.json() as any).error).toBe('video_url_must_use_verified_https_host');
  });

  it('requires both server enablement and explicit private-publish confirmation', async () => {
    const response = await publishPost({
      request: jsonRequest({
        ...base,
        mode: 'publish',
        confirm: 'PUBLISH_PRIVATE',
        idempotencyKey: 'tiktok-test-001',
      }),
      env: env({ TIKTOK_IDEMPOTENCY: kv() }),
    } as any);
    expect(response.status).toBe(403);
  });

  it('refuses publishing without durable idempotency storage', async () => {
    const response = await publishPost({
      request: jsonRequest({
        ...base,
        mode: 'publish',
        confirm: 'PUBLISH_PRIVATE',
        idempotencyKey: 'tiktok-test-001',
      }),
      env: env({ TIKTOK_PUBLISH_ENABLED: 'true' }),
    } as any);
    expect(response.status).toBe(503);
  });

  it('queries creator info, forces SELF_ONLY, initializes once, then replays safely', async () => {
    const store = kv();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(ok({
        creator_username: 'zenithjoy',
        privacy_level_options: ['SELF_ONLY'],
        max_video_post_duration_sec: 60,
      }))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const sent = JSON.parse(String(init.body));
        expect(sent.post_info.privacy_level).toBe('SELF_ONLY');
        expect(sent.post_info.disable_comment).toBe(true);
        expect(sent.post_info.disable_duet).toBe(true);
        expect(sent.post_info.disable_stitch).toBe(true);
        expect(sent.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: base.videoUrl });
        return ok({ publish_id: 'v_pub_url~v2.123' });
      });
    vi.stubGlobal('fetch', fetchSpy);

    const payload = {
      ...base,
      mode: 'publish',
      confirm: 'PUBLISH_PRIVATE',
      idempotencyKey: 'tiktok-test-001',
    };
    const first = await publishPost({
      request: jsonRequest(payload),
      env: env({ TIKTOK_PUBLISH_ENABLED: 'true', TIKTOK_IDEMPOTENCY: store }),
    } as any);
    expect(first.status).toBe(200);
    expect((await first.json() as any).result.publishId).toBe('v_pub_url~v2.123');

    const replay = await publishPost({
      request: jsonRequest(payload),
      env: env({ TIKTOK_PUBLISH_ENABLED: 'true', TIKTOK_IDEMPOTENCY: store }),
    } as any);
    expect(replay.status).toBe(200);
    expect((await replay.json() as any).replayed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stops before initialization when SELF_ONLY is unavailable', async () => {
    const fetchSpy = vi.fn(async () => ok({
      creator_username: 'zenithjoy',
      privacy_level_options: ['PUBLIC_TO_EVERYONE'],
      max_video_post_duration_sec: 60,
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const response = await publishPost({
      request: jsonRequest({
        ...base,
        mode: 'publish',
        confirm: 'PUBLISH_PRIVATE',
        idempotencyKey: 'tiktok-test-002',
      }),
      env: env({ TIKTOK_PUBLISH_ENABLED: 'true', TIKTOK_IDEMPOTENCY: kv() }),
    } as any);
    expect(response.status).toBe(409);
    expect((await response.json() as any).error).toBe('self_only_not_available');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stops when the video exceeds the creator duration limit', async () => {
    const fetchSpy = vi.fn(async () => ok({
      creator_username: 'zenithjoy',
      privacy_level_options: ['SELF_ONLY'],
      max_video_post_duration_sec: 3,
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const response = await publishPost({
      request: jsonRequest({
        ...base,
        mode: 'publish',
        confirm: 'PUBLISH_PRIVATE',
        idempotencyKey: 'tiktok-test-003',
      }),
      env: env({ TIKTOK_PUBLISH_ENABLED: 'true', TIKTOK_IDEMPOTENCY: kv() }),
    } as any);
    expect(response.status).toBe(409);
    expect((await response.json() as any).error).toBe('video_exceeds_creator_duration_limit');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/tiktok/status', () => {
  it('reads processing status by publish ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ publish_id: 'v_pub_url~v2.123' });
      return ok({ status: 'PROCESSING_DOWNLOAD', downloaded_bytes: 4096 });
    }));
    const response = await statusPost({
      request: request('https://zenithjoyai.com/api/tiktok/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishId: 'v_pub_url~v2.123' }),
      }),
      env: env(),
    } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.status).toBe('PROCESSING_DOWNLOAD');
    expect(body.transferredBytes).toBe(4096);
  });
});
