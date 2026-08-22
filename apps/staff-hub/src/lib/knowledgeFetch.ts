/**
 * 知识中枢专用 fetch —— 只带会话 cookie，一个身份头都不拼。
 *
 * 不复用 admin 那条通道：它会把两个明文身份头拼进请求，而知识面的服务端闸
 * （knowledgeAuthGuard）压根不读请求头。更要紧的是反过来：那两个头是既有 16 个
 * staffGuard 端点的唯一凭据，摘掉就全站 403，所以两条路必须各走各的，谁都别动谁。
 */
export interface KnowledgeError {
  code: string;
  message: string;
}

export class KnowledgeRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, error: KnowledgeError) {
    super(error.message);
    this.name = 'KnowledgeRequestError';
    this.status = status;
    this.code = error.code;
  }
}

/**
 * 组织态错误的全局哨兵：数据端点在「归属 ≥2 家但未选」时返 409 ORG_SELECTION_REQUIRED，
 * 在「会话 active_org 失效/被伪造」时返 403 ORG_FORBIDDEN。这两个码不管从哪个页面撞上，
 * 处理方式都一样（逼选 / 刷新归属重选），所以在解析层集中上报给 AuthContext 一处处理，
 * 免得每个页面各写一遍。页面自己该出的错误文案照旧出，这里只是额外通知。
 */
export type OrgContextErrorCode = 'ORG_SELECTION_REQUIRED' | 'ORG_FORBIDDEN';
type OrgErrorListener = (code: OrgContextErrorCode) => void;
let orgErrorListener: OrgErrorListener | null = null;

export function setOrgErrorListener(fn: OrgErrorListener | null): void {
  orgErrorListener = fn;
}

export function knowledgeFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: HeadersInit = {
    ...(init?.headers ?? {}),
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
  };
  return fetch(url, { ...init, credentials: 'include', headers });
}

/**
 * 解析统一响应体。失败一律抛 KnowledgeRequestError 带上原因码 ——
 * 页面据此区分「登录已失效，请重新登录」「没有权限」「账本暂时不可达」三种文案，
 * 绝不把失败显示成空列表（那会被读成"库里还没有"，一次静默故障就此隐身）。
 */
export async function knowledgeJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await knowledgeFetch(url, init);
  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: T; error?: KnowledgeError }
    | null;

  if (!res.ok || !body?.success) {
    const err = new KnowledgeRequestError(res.status, {
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `请求失败（HTTP ${res.status}）`,
    });
    if (err.code === 'ORG_SELECTION_REQUIRED' || err.code === 'ORG_FORBIDDEN') {
      orgErrorListener?.(err.code);
    }
    throw err;
  }
  return body.data as T;
}
