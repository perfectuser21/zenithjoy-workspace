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
    throw new KnowledgeRequestError(res.status, {
      code: body?.error?.code ?? 'UNKNOWN',
      message: body?.error?.message ?? `请求失败（HTTP ${res.status}）`,
    });
  }
  return body.data as T;
}
