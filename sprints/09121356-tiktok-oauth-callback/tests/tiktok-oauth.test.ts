import { describe, it, expect, vi } from 'vitest';

import {
  escapeHtml,
  signState,
  verifyState,
  parseTokenResponse,
} from '../../../apps/geoai/functions/api/auth/tiktok/_lib';
import { onRequestGet as callbackGet } from '../../../apps/geoai/functions/api/auth/tiktok/callback';
import { onRequestGet as startGet } from '../../../apps/geoai/functions/api/auth/tiktok/start';

const SECRET = 'test-state-secret-value';

function ctx(url: string, env: Record<string, string> = {}, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  return { request: new Request(url, { headers }), env } as any;
}

function fullEnv(extra: Record<string, string> = {}) {
  return {
    TIKTOK_CLIENT_KEY: 'ck_test',
    TIKTOK_CLIENT_SECRET: 'cs_test',
    TIKTOK_STATE_SECRET: SECRET,
    ...extra,
  };
}

describe('escapeHtml — 防反射型 XSS', () => {
  it('转义所有 HTML 敏感字符', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('非字符串输入不抛异常', () => {
    expect(escapeHtml(undefined as any)).toBe('');
    expect(escapeHtml(null as any)).toBe('');
  });
});

describe('state 签名与校验', () => {
  it('自己签发的 state 能通过校验', async () => {
    const { state, nonce } = await signState(SECRET, 1_700_000_000_000);
    const r = await verifyState(SECRET, state, nonce, 1_700_000_000_000);
    expect(r.ok).toBe(true);
  });

  it('篡改过的 state 被拒绝', async () => {
    const { state, nonce } = await signState(SECRET, 1_700_000_000_000);
    const tampered = state.slice(0, -4) + 'aaaa';
    const r = await verifyState(SECRET, tampered, nonce, 1_700_000_000_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('用别的密钥签的 state 被拒绝', async () => {
    const { state, nonce } = await signState('another-secret', 1_700_000_000_000);
    const r = await verifyState(SECRET, state, nonce, 1_700_000_000_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('超过 TTL 的 state 被拒绝（过期）', async () => {
    const t0 = 1_700_000_000_000;
    const { state, nonce } = await signState(SECRET, t0);
    const r = await verifyState(SECRET, state, nonce, t0 + 16 * 60 * 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('cookie 里的 nonce 对不上时被拒绝（CSRF 核心防线）', async () => {
    const { state } = await signState(SECRET, 1_700_000_000_000);
    const r = await verifyState(SECRET, state, 'attacker-nonce', 1_700_000_000_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('nonce_mismatch');
  });

  it('cookie 缺失时被拒绝，不能放行', async () => {
    const { state } = await signState(SECRET, 1_700_000_000_000);
    const r = await verifyState(SECRET, state, undefined, 1_700_000_000_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_cookie');
  });
});

describe('parseTokenResponse — TikTok 出错时仍返回 HTTP 200', () => {
  it('body 里带 error 即判定失败，哪怕 HTTP 200', () => {
    const r = parseTokenResponse(200, {
      error: 'invalid_grant',
      error_description: 'authorization code expired',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_grant');
  });

  it('正常 token 响应判定成功', () => {
    const r = parseTokenResponse(200, {
      access_token: 'act.xxx',
      refresh_token: 'rft.xxx',
      expires_in: 86400,
      open_id: 'oid',
      scope: 'video.publish',
    });
    expect(r.ok).toBe(true);
    expect(r.data?.access_token).toBe('act.xxx');
  });

  it('缺少 access_token 判定失败，不能当成功', () => {
    const r = parseTokenResponse(200, { expires_in: 86400 });
    expect(r.ok).toBe(false);
  });

  it('非对象响应（TikTok 返回 HTML 等）不抛异常', () => {
    const r = parseTokenResponse(502, '<html>Bad Gateway</html>' as any);
    expect(r.ok).toBe(false);
  });
});

describe('callback 端点', () => {
  it('凭据未配置时返回 200 友好页，绝不 5xx（审核员访问时刻）', async () => {
    const res = await callbackGet(ctx('https://zenithjoyai.com/api/auth/tiktok/callback', {}));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/not configured|尚未配置/i);
  });

  it('所有响应都带 noindex，防污染 SEO', async () => {
    const res = await callbackGet(ctx('https://zenithjoyai.com/api/auth/tiktok/callback', {}));
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('token 展示相关响应禁缓存、禁 referrer', async () => {
    const res = await callbackGet(ctx('https://zenithjoyai.com/api/auth/tiktok/callback', {}));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('用户拒绝授权时显示已取消，且不发起 token 请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callbackGet(
      ctx(
        'https://zenithjoyai.com/api/auth/tiktok/callback?error=access_denied&error_description=user+denied',
        fullEnv(),
      ),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.text();
    expect(body).toMatch(/cancel|取消/i);
    vi.unstubAllGlobals();
  });

  it('error_description 里的 HTML 被转义，不构成 XSS', async () => {
    const res = await callbackGet(
      ctx(
        'https://zenithjoyai.com/api/auth/tiktok/callback?error=x&error_description=' +
          encodeURIComponent('<img src=x onerror=alert(1)>'),
        fullEnv(),
      ),
    );
    const body = await res.text();
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;img');
  });

  it('裸访问（无 code 无 error）不发起任何外发请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callbackGet(
      ctx('https://zenithjoyai.com/api/auth/tiktok/callback', fullEnv()),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('state 校验不过时拒绝，且不发起 token 请求', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await callbackGet(
      ctx(
        'https://zenithjoyai.com/api/auth/tiktok/callback?code=abc&state=forged',
        fullEnv(),
      ),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = await res.text();
    expect(body).toMatch(/verification failed|校验失败/i);
    vi.unstubAllGlobals();
  });

  it('code 末尾的 %2A 被正确还原成 *（否则 TikTok 必报 invalid_grant）', async () => {
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);
    const { state, nonce } = await signState(SECRET, t0);
    let sentBody = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: any, init: any) => {
        sentBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 1, open_id: 'o' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
    await callbackGet(
      ctx(
        `https://zenithjoyai.com/api/auth/tiktok/callback?code=thecode%2A&state=${encodeURIComponent(state)}`,
        fullEnv(),
        `tt_oauth_nonce=${nonce}`,
      ),
    );
    expect(sentBody).toContain('thecode*');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('网络异常时降级显示错误页，不抛异常崩掉', async () => {
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);
    const { state, nonce } = await signState(SECRET, t0);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const res = await callbackGet(
      ctx(
        `https://zenithjoyai.com/api/auth/tiktok/callback?code=abc&state=${encodeURIComponent(state)}`,
        fullEnv(),
        `tt_oauth_nonce=${nonce}`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/failed|失败/i);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe('start 端点', () => {
  it('凭据未配置时返回 200 友好页，不 5xx', async () => {
    const res = await startGet(ctx('https://zenithjoyai.com/api/auth/tiktok/start', {}));
    expect(res.status).toBe(200);
  });

  it('配置齐全时 302 跳 TikTok，并种下 HttpOnly cookie', async () => {
    const res = await startGet(
      ctx('https://zenithjoyai.com/api/auth/tiktok/start', fullEnv()),
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location') || '';
    expect(loc).toContain('tiktok.com');
    expect(loc).toContain('client_key=ck_test');
    expect(loc).toContain('state=');

    const setCookie = res.headers.get('Set-Cookie') || '';
    expect(setCookie).toContain('tt_oauth_nonce=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
  });

  it('start 签发的 state 能被 callback 校验通过（端到端自洽）', async () => {
    const res = await startGet(
      ctx('https://zenithjoyai.com/api/auth/tiktok/start', fullEnv()),
    );
    const loc = new URL(res.headers.get('Location')!);
    const state = loc.searchParams.get('state')!;
    const nonce = (res.headers.get('Set-Cookie') || '').match(/tt_oauth_nonce=([^;]+)/)![1];
    const r = await verifyState(SECRET, state, nonce, Date.now());
    expect(r.ok).toBe(true);
  });
});
