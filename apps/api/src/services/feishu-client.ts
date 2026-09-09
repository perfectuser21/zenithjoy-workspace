// apps/api/src/services/feishu-client.ts
//
// 飞书轻客户端：token 模块缓存 + 请求封装的唯一来源，专供 feishu-orchestrator worker
// （刀5b Task2）。与 feishu-token.ts 的多租户 OAuth 路线隔离——这里走全局 env
// FEISHU_APP_ID/FEISHU_APP_SECRET 单租户路线（照 feishu-bitable.ts getTenantToken
// 惯例，净增模块级缓存）。
//
// 错误纪律同 notion-client.ts：绝不把原始 AxiosError / app_secret / token 往外抛或
// 往日志打——config.headers 里有 Authorization: Bearer <token>，请求体里有
// app_secret，泄漏即飞书应用全部数据的钥匙。统一收敛成只含 method/path/status/
// response.data 的普通 Error。
//
// 频控：飞书业务码 1254290（TooManyRequest）→ 抛 FeishuRateLimitError，
// 供 feishu-orchestrator worker 识别后跳过本轮（不算错误重试打满）。

import axios from 'axios';

const FEISHU_API_BASE = () => process.env.FEISHU_API_BASE || 'https://open.feishu.cn';
// 5min 提前刷新，同 feishu-token.ts REFRESH_THRESHOLD_MS 阈值惯例
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRE_SEC = 7200;
const RATE_LIMIT_CODE = 1254290;

export class FeishuRateLimitError extends Error {
  code = 'FEISHU_RATE_LIMIT';
  constructor(msg: string) {
    super(msg);
    this.name = 'FeishuRateLimitError';
  }
}

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

/** 仅供测试重置模块级 token 缓存。 */
export function _resetTokenCache(): void {
  tokenCache = null;
}

interface TenantTokenResp {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

async function fetchTenantToken(): Promise<TokenCache> {
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置');
  }

  let resp: { data: TenantTokenResp };
  try {
    resp = await axios.post<TenantTokenResp>(
      `${FEISHU_API_BASE()}/open-apis/auth/v3/tenant_access_token/internal`,
      { app_id: appId, app_secret: appSecret },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
    );
  } catch (err) {
    // 与 feishuRequest 同一套脱敏纪律：绝不上抛原始 err（其 config.data 里带明文
    // app_id/app_secret），新 Error 只含 status/response.data/message。
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = e.response
      ? `${e.response.status} ${JSON.stringify(e.response.data ?? '')}`
      : (e.message ?? 'unknown');
    throw new Error(`飞书获取 token 失败: ${detail}`.slice(0, 500));
  }

  const data = resp.data || ({} as TenantTokenResp);
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书获取 token 失败: code=${data.code ?? 'unknown'}`);
  }
  const expireSec = data.expire ?? DEFAULT_EXPIRE_SEC;
  return { token: data.tenant_access_token, expiresAt: Date.now() + expireSec * 1000 };
}

// 换取中的 in-flight promise：缓存未命中时并发调用者共享同一次 fetch，
// 不会各发各的 tenant_access_token 请求。无论成功失败都在 settle 后清空，
// 失败时下一次调用能重新发起请求，不会永久卡坏一个 rejected promise。
let tokenFetchInFlight: Promise<TokenCache> | null = null;

/** 拿有效 tenant_access_token；命中模块级缓存则不发请求；并发未命中时单飞。 */
export async function getTenantToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - Date.now() > REFRESH_THRESHOLD_MS) {
    return tokenCache.token;
  }
  if (!tokenFetchInFlight) {
    tokenFetchInFlight = fetchTenantToken().finally(() => {
      tokenFetchInFlight = null;
    });
  }
  tokenCache = await tokenFetchInFlight;
  return tokenCache.token;
}

interface FeishuBizBody {
  code?: number;
  msg?: string;
}

/** 飞书通用请求封装：FEISHU_API_BASE 可注入（fake-server CI 惯例）。 */
export async function feishuRequest<T = unknown>(
  method: 'get' | 'post' | 'put',
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getTenantToken();

  let resp: { data: T };
  try {
    resp = await axios.request<T>({
      method,
      url: `${FEISHU_API_BASE()}${path}`,
      data: body,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
  } catch (err) {
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    const bizCode = (e.response?.data as FeishuBizBody | undefined)?.code;
    if (bizCode === RATE_LIMIT_CODE) {
      throw new FeishuRateLimitError(
        `飞书频控: ${JSON.stringify(e.response?.data ?? '')}`.slice(0, 500)
      );
    }
    const detail = e.response
      ? `${e.response.status} ${JSON.stringify(e.response.data ?? '')}`
      : (e.message ?? 'unknown');
    throw new Error(`飞书 API ${method.toUpperCase()} ${path} 失败: ${detail}`.slice(0, 500));
  }

  const data = resp.data as unknown as FeishuBizBody;
  if (data && typeof data.code === 'number' && data.code !== 0) {
    if (data.code === RATE_LIMIT_CODE) {
      throw new FeishuRateLimitError(
        `飞书频控: code=${data.code} msg=${data.msg ?? ''}`.slice(0, 500)
      );
    }
    throw new Error(
      `飞书 API ${method.toUpperCase()} ${path} 失败: code=${data.code} msg=${data.msg ?? ''}`.slice(
        0,
        500
      )
    );
  }

  return resp.data;
}
