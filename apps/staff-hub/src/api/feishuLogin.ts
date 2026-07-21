export interface FeishuLoginResult {
  success: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    feishu_user_id: string;
    access_token: string;
  };
  error?: string;
}

/**
 * 用飞书授权 code 换登录态。
 * 打的是 /api/staff/feishu-login（走 staffGuard 之前挂的公开路由，做 STAFF_EMAILS 白名单核对），
 * 不是裸 /api/feishu-login（那条会被 nginx 代理到 hk-vps 上没有白名单概念的通用飞书登录服务，
 * 任何飞书账号都能登进去，对 Staff Hub 来说是权限漏洞——见 issue 补记）。
 */
export async function feishuLogin(code: string): Promise<FeishuLoginResult> {
  const response = await fetch('/api/staff/feishu-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return response.json();
}
