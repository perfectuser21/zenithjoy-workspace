// apps/api/src/services/notion-client.ts
//
// Notion API 轻客户端：常量/鉴权/请求封装的唯一来源（notion-crm 与
// notion-orchestrator 共用——复用即引用，不复制）。
//
// 错误纪律：绝不把原始 AxiosError 往外抛/往日志打——config.headers 里有
// Authorization: Bearer <token>，泄漏即 workspace 全部数据的钥匙。
// 这里统一收敛成只含 method/path/status/response.data 的普通 Error。

import axios from 'axios';

export const NOTION_API_BASE = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';

export function getNotionToken(): string {
  return process.env.NOTION_INTEGRATION_TOKEN || '';
}

export async function notionRequest<T = unknown>(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getNotionToken();
  if (!token) {
    throw new Error('NOTION_INTEGRATION_TOKEN 未配置');
  }
  try {
    const resp = await axios.request<T>({
      method,
      url: `${NOTION_API_BASE}${path}`,
      data: body,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
    return resp.data;
  } catch (err) {
    const e = err as { message?: string; response?: { status?: number; data?: unknown } };
    const detail = e.response
      ? `${e.response.status} ${JSON.stringify(e.response.data ?? '')}`
      : (e.message ?? 'unknown');
    throw new Error(`Notion API ${method.toUpperCase()} ${path} 失败: ${detail}`.slice(0, 500));
  }
}
