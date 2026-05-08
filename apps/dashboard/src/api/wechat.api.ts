/**
 * Path 4 Sprint 1 ws2 — Dashboard 微信 API client
 *
 * 端点：
 *   POST /api/wechat/qr-bind  {platform: 'wechat_personal', agent_id} → {task_id, status}
 */

const API_BASE = '/api';

export interface WechatQrBindBody {
  platform: 'wechat_personal' | 'wechat_enterprise';
  agent_id: string;
}

export interface WechatQrBindResponse {
  task_id: string;
  status: 'dispatched' | 'pending' | 'failed';
}

function getLicenseToken(): string {
  try {
    if (typeof document !== 'undefined' && typeof document.cookie === 'string') {
      const m = document.cookie.match(/(^|; )license=([^;]+)/);
      if (m) return decodeURIComponent(m[2]);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage.getItem('zj_license') || '';
    }
  } catch {
    // ignore
  }
  return '';
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const lic = getLicenseToken();
  if (lic) headers.set('Authorization', `Bearer ${lic}`);
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  if (!res.ok) {
    const errBody = json.error as { message?: string } | string | undefined;
    const msg =
      typeof errBody === 'string'
        ? errBody
        : errBody?.message || res.statusText;
    throw new Error(`HTTP_${res.status}: ${msg}`);
  }
  return json as T;
}

export async function postWechatQrBind(
  body: WechatQrBindBody,
): Promise<WechatQrBindResponse> {
  return postJson<WechatQrBindResponse>('/wechat/qr-bind', body);
}
