/**
 * GET /api/auth/tiktok/callback
 *
 * 接收 TikTok 回跳，校验 state，用 code 换 token。
 *
 * 设计前提：这是**单账号自用**工具，不做多租户，因此不引入任何存储设施 ——
 * token 一次性展示，由人工存进 1Password。页面刻意不复用站点 layout，
 * 避免站点统计脚本读到 token。
 */
import {
  NONCE_COOKIE,
  escapeHtml,
  missingConfig,
  notConfiguredPage,
  parseTokenResponse,
  readCookie,
  renderPage,
  verifyState,
  type TikTokEnv,
} from './_lib';

const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIMEOUT_MS = 10_000;

export async function onRequestGet(context: {
  request: Request;
  env: TikTokEnv;
}): Promise<Response> {
  const { request, env } = context;

  if (missingConfig(env).length > 0) return notConfiguredPage();

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  // URLSearchParams 已做过一次 decode；TikTok 的 code 常以 %2A 结尾，
  // 这里拿到的就是还原后的 `*`，不能再 decode 一次。
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  // ── TikTok 明确回报错误（最常见是用户点了拒绝）──
  if (error) {
    const desc = url.searchParams.get('error_description') || '';
    return renderPage(
      'Authorization cancelled',
      `<h1>Authorization was cancelled</h1>
       <p>TikTok returned: <code>${escapeHtml(error)}</code></p>
       ${desc ? `<p class="muted">${escapeHtml(desc)}</p>` : ''}
       <p class="muted">已取消授权，可关闭此页面后重试。</p>`,
    );
  }

  // ── 裸访问：没有 code 也没有 error。零外发请求。──
  if (!code) {
    return renderPage(
      'TikTok OAuth callback',
      `<h1>TikTok OAuth callback</h1>
       <p>This endpoint handles the OAuth redirect from TikTok. There is nothing to do
          when opened directly.</p>
       <p class="muted">直接访问无操作。</p>`,
    );
  }

  // ── state 三重校验：签名 → 时效 → cookie nonce 绑定 ──
  const verdict = await verifyState(
    env.TIKTOK_STATE_SECRET!,
    state,
    readCookie(request, NONCE_COOKIE),
  );
  if (!verdict.ok) {
    // 刻意不把具体 reason 显示给访问者，避免给攻击者反馈信号。
    return renderPage(
      'Verification failed',
      `<h1>Request verification failed</h1>
       <p>This authorization request could not be verified. Please start the flow again
          from the beginning.</p>
       <p class="muted">校验失败，请重新发起授权。</p>`,
    );
  }

  // ── 换取 token ──
  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${url.origin}/api/auth/tiktok/callback`,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      // TikTok 偶尔在网关层返回 HTML，不能让 JSON 解析异常冒泡成 500。
      body = null;
    }
  } catch {
    return renderPage(
      'Token exchange failed',
      `<h1>Could not reach TikTok</h1>
       <p>The token exchange request failed before completing. This is usually transient.</p>
       <p class="muted">请求失败，请重新发起授权。</p>`,
    );
  }

  const parsed = parseTokenResponse(status, body);
  if (!parsed.ok) {
    return renderPage(
      'Token exchange failed',
      `<h1>Authorization could not be completed</h1>
       <p>TikTok returned: <code>${escapeHtml(parsed.error)}</code></p>
       ${parsed.description ? `<p class="muted">${escapeHtml(parsed.description)}</p>` : ''}
       <p class="muted">若刚刷新过本页，授权码已失效属正常，请重新发起授权。</p>`,
    );
  }

  const t = parsed.data;
  return renderPage(
    'Authorization complete',
    `<h1>Authorization complete</h1>
     <p>Copy these values into your password manager now. They are shown once and are
        not stored anywhere by this site.</p>
     <p><strong>access_token</strong><br><code>${escapeHtml(t.access_token)}</code></p>
     ${t.refresh_token ? `<p><strong>refresh_token</strong><br><code>${escapeHtml(t.refresh_token)}</code></p>` : ''}
     ${t.open_id ? `<p><strong>open_id</strong><br><code>${escapeHtml(t.open_id)}</code></p>` : ''}
     ${t.scope ? `<p><strong>scope</strong><br><code>${escapeHtml(t.scope)}</code></p>` : ''}
     ${typeof t.expires_in === 'number' ? `<p class="muted">access_token expires in ${t.expires_in}s</p>` : ''}
     <p class="muted">请立即存入 1Password。本页不做任何存储，刷新即失效。</p>`,
  );
}
