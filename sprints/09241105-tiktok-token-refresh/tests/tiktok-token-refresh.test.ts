import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveTikTokAccessToken,
  tiktokRequest,
  type D1Like,
  type TikTokPublishEnv,
} from '../../../apps/geoai/functions/api/tiktok/_lib';

const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';

/** D1 替身：只实现 token 表用到的 SQL，行为与 SQLite 一致。 */
function fakeD1(seed?: Record<string, unknown>): D1Like & { row: () => any } {
  let row: Record<string, unknown> | null = seed ?? null;
  return {
    row: () => row,
    prepare(query: string) {
      return {
        bind(...v: unknown[]) {
          return {
            async run() {
              if (query.includes('INSERT INTO tiktok_oauth_tokens')) {
                const [accessToken, refreshToken, expiresAt, updatedAt] = v;
                row = {
                  id: 'default',
                  access_token: accessToken,
                  refresh_token: refreshToken,
                  expires_at: expiresAt,
                  updated_at: updatedAt,
                };
                return { meta: { changes: 1 } };
              }
              throw new Error(`unexpected SQL: ${query}`);
            },
            async first<T>() {
              if (query.includes('SELECT access_token')) return (row ?? null) as T | null;
              throw new Error(`unexpected SQL: ${query}`);
            },
          };
        },
      };
    },
  };
}

function env(extra: Partial<TikTokPublishEnv> = {}): TikTokPublishEnv {
  return {
    TIKTOK_ACCESS_TOKEN: 'act.seed-token',
    TIKTOK_REFRESH_TOKEN: 'rft.seed-refresh',
    TIKTOK_CLIENT_KEY: 'awclientkey',
    TIKTOK_CLIENT_SECRET: 'clientsecret',
    TIKTOK_PUBLISH_API_KEY: 'bridge-key',
    ...extra,
  } as TikTokPublishEnv;
}

function tokenOk(access: string, refresh: string, expiresIn = 86400) {
  return new Response(
    JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function apiOk(data: unknown) {
  return new Response(
    JSON.stringify({ data, error: { code: 'ok', message: '', log_id: 'l' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function apiTokenInvalid() {
  return new Response(
    JSON.stringify({
      data: {},
      error: { code: 'access_token_invalid', message: 'TikTok rejected the request.', log_id: 'l' },
    }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TikTok access token 自动刷新', () => {
  it('token 过期时自己换新的，不需要人工重新授权', async () => {
    const db = fakeD1({
      id: 'default',
      access_token: 'act.expired',
      refresh_token: 'rft.still-valid',
      expires_at: '2020-01-01T00:00:00.000Z', // 早就过期
      updated_at: '2020-01-01T00:00:00.000Z',
    });
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) return tokenOk('act.fresh', 'rft.rotated');
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const token = await resolveTikTokAccessToken(env({ TIKTOK_PUBLISH_DB: db }));
    expect(token).toBe('act.fresh');
    // TikTok 会轮换 refresh_token，不回写就等于把下一次刷新的钥匙丢了。
    expect(db.row().refresh_token).toBe('rft.rotated');
  });

  it('token 还没过期就不去打扰 TikTok', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const db = fakeD1({
      id: 'default',
      access_token: 'act.good',
      refresh_token: 'rft.x',
      expires_at: future,
      updated_at: future,
    });
    const fetchSpy = vi.fn(async () => { throw new Error('不应发起任何请求'); });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await resolveTikTokAccessToken(env({ TIKTOK_PUBLISH_DB: db }))).toBe('act.good');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('D1 里还没有记录时，用 env 里的值做种子并落库', async () => {
    const db = fakeD1();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('不应发起任何请求'); }));
    expect(await resolveTikTokAccessToken(env({ TIKTOK_PUBLISH_DB: db }))).toBe('act.seed-token');
    expect(db.row()?.access_token).toBe('act.seed-token');
  });

  it('上游回 access_token_invalid 时刷新并重试一次，调用方看到的是成功', async () => {
    const db = fakeD1({
      id: 'default',
      access_token: 'act.stale',
      refresh_token: 'rft.valid',
      expires_at: new Date(Date.now() + 3600_000).toISOString(), // 自以为没过期
      updated_at: new Date().toISOString(),
    });
    let apiCalls = 0;
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url) === TOKEN_ENDPOINT) return tokenOk('act.fresh2', 'rft.rotated2');
      apiCalls += 1;
      const auth = new Headers(init.headers).get('Authorization');
      // 第一次带旧票被拒，刷新后必须用新票重试
      if (auth === 'Bearer act.stale') return apiTokenInvalid();
      if (auth === 'Bearer act.fresh2') return apiOk({ publish_id: 'v_1' });
      throw new Error(`unexpected auth: ${auth}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await tiktokRequest<{ publish_id: string }>(
      env({ TIKTOK_PUBLISH_DB: db }),
      '/v2/post/publish/video/init/',
    );
    expect(res.ok).toBe(true);
    expect(apiCalls).toBe(2); // 原调用 + 刷新后重试
    expect(db.row().access_token).toBe('act.fresh2');
  });

  it('刷新失败时如实报错，不把旧票伪装成可用', async () => {
    const db = fakeD1({
      id: 'default',
      access_token: 'act.dead',
      refresh_token: 'rft.dead',
      expires_at: '2020-01-01T00:00:00.000Z',
      updated_at: '2020-01-01T00:00:00.000Z',
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === TOKEN_ENDPOINT) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
      }
      throw new Error('不该走到上游');
    }));
    await expect(resolveTikTokAccessToken(env({ TIKTOK_PUBLISH_DB: db }))).rejects.toThrow();
  });
});
