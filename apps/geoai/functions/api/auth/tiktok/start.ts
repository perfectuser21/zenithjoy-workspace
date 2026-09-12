/**
 * GET /api/auth/tiktok/start
 *
 * 发起 TikTok 授权。职责只有一件：签发 state 并与 HttpOnly cookie 绑定，
 * 然后把用户送去 TikTok。没有这一步，callback 就无法判断 state 是不是自己签发的。
 */
import {
  NONCE_COOKIE,
  missingConfig,
  notConfiguredPage,
  signState,
  type TikTokEnv,
} from './_lib';

const AUTH_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
const DEFAULT_SCOPE = 'user.info.basic,video.publish,video.upload';

export async function onRequestGet(context: {
  request: Request;
  env: TikTokEnv;
}): Promise<Response> {
  const { request, env } = context;

  if (missingConfig(env).length > 0) return notConfiguredPage();

  const origin = new URL(request.url).origin;
  const { state, nonce } = await signState(env.TIKTOK_STATE_SECRET!);

  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY!,
    response_type: 'code',
    scope: DEFAULT_SCOPE,
    redirect_uri: `${origin}/api/auth/tiktok/callback`,
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${AUTH_ENDPOINT}?${params.toString()}`,
      // SameSite=Lax 而非 Strict：TikTok 跳回来是顶层导航，Strict 会导致 cookie 不发送。
      'Set-Cookie': `${NONCE_COOKIE}=${nonce}; Path=/api/auth/tiktok; Max-Age=900; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
