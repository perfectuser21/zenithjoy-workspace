/**
 * TikTok OAuth 共享工具。
 *
 * 以 `_` 开头的文件不会被 Cloudflare Pages 当成路由，只作为模块被引用。
 * 运行环境是 Workers runtime（非 Node）：只能用 Web 标准 API（crypto.subtle / fetch / Request）。
 */

const STATE_TTL_MS = 15 * 60 * 1000;
export const NONCE_COOKIE = 'tt_oauth_nonce';

export interface TikTokEnv {
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_STATE_SECRET?: string;
}

/** 转义 HTML，任何来自 TikTok 或 query 的文本进页面前都必须过这一层。 */
export function escapeHtml(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

/** 定时比较，避免通过响应时间旁路推断签名。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

/**
 * 签发 state。state 自带 nonce 与时间戳，并用服务端密钥签名。
 * 返回的 nonce 同时写进 HttpOnly cookie —— 两者必须配对才算合法，
 * 这是纯静态站没有 session 时唯一能真正防住 CSRF / account confusion 的办法。
 */
export async function signState(
  secret: string,
  now: number = Date.now(),
): Promise<{ state: string; nonce: string }> {
  const nonce = randomNonce();
  const payload = `${nonce}.${now}`;
  const sig = await hmacHex(secret, payload);
  return { state: `${payload}.${sig}`, nonce };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'no_cookie' | 'nonce_mismatch' };

/** 校验顺序刻意如此：先证明 state 是我们签的，再谈时效与 cookie 绑定。 */
export async function verifyState(
  secret: string,
  state: string | null | undefined,
  cookieNonce: string | null | undefined,
  now: number = Date.now(),
): Promise<VerifyResult> {
  if (typeof state !== 'string') return { ok: false, reason: 'malformed' };
  const parts = state.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [nonce, tsRaw, sig] = parts;
  const expected = await hmacHex(secret, `${nonce}.${tsRaw}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: 'bad_signature' };

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || now - ts > STATE_TTL_MS || now - ts < 0) {
    return { ok: false, reason: 'expired' };
  }

  if (!cookieNonce) return { ok: false, reason: 'no_cookie' };
  if (!timingSafeEqual(cookieNonce, nonce)) return { ok: false, reason: 'nonce_mismatch' };

  return { ok: true };
}

export function readCookie(request: Request, name: string): string | undefined {
  const raw = request.headers.get('Cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  open_id?: string;
  scope?: string;
}

/**
 * TikTok 在业务失败时**依然返回 HTTP 200**，错误藏在 body 里。
 * 所以判定成功与否一律看 body，不看状态码。
 */
export function parseTokenResponse(
  _status: number,
  body: unknown,
): { ok: true; data: TokenData } | { ok: false; error: string; description: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'bad_response', description: 'Unexpected response from TikTok.' };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.error === 'string' && b.error) {
    return {
      ok: false,
      error: b.error,
      description: typeof b.error_description === 'string' ? b.error_description : '',
    };
  }
  if (typeof b.access_token !== 'string' || !b.access_token) {
    return { ok: false, error: 'no_access_token', description: 'Response contained no access token.' };
  }
  return { ok: true, data: b as unknown as TokenData };
}

/** 所有响应统一头：禁索引（保护站点 SEO/GEO）、禁缓存、禁 referrer 外泄。 */
export function secureHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    ...extra,
  };
}

/**
 * 极简独立页面：刻意不复用站点 layout，避免统计脚本/第三方组件读到页面上的 token。
 */
export function renderPage(title: string, bodyHtml: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
  body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       max-width:640px;margin:12vh auto;padding:0 24px;color:#1a1a1a;background:#fafafa}
  h1{font-size:20px;margin:0 0 12px}
  p{margin:8px 0;color:#444}
  code{background:#eee;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
  .box{background:#fff;border:1px solid #e3e3e3;border-radius:8px;padding:20px}
  .muted{color:#888;font-size:13px}
</style>
</head><body><div class="box">${bodyHtml}</div></body></html>`;
  return new Response(html, { status, headers: secureHeaders() });
}

/** 三个变量缺任何一个都算未配置 —— 上线初期必然处于这个状态。 */
export function missingConfig(env: TikTokEnv): string[] {
  const missing: string[] = [];
  if (!env?.TIKTOK_CLIENT_KEY) missing.push('TIKTOK_CLIENT_KEY');
  if (!env?.TIKTOK_CLIENT_SECRET) missing.push('TIKTOK_CLIENT_SECRET');
  if (!env?.TIKTOK_STATE_SECRET) missing.push('TIKTOK_STATE_SECRET');
  return missing;
}

/**
 * 未配置时的响应。必须是 200：这个状态恰好是 TikTok 审核员来点 URL 的时刻，
 * 回 5xx 会让端点看起来是坏的，直接影响过审。同时不回显任何变量值。
 */
export function notConfiguredPage(): Response {
  return renderPage(
    'Endpoint ready',
    `<h1>Endpoint is live, awaiting credentials</h1>
     <p>This OAuth endpoint is deployed and reachable. It is not configured with API
        credentials yet, so no authorization can be completed at this time.</p>
     <p class="muted">尚未配置凭据，端点本身已就绪。</p>`,
  );
}
