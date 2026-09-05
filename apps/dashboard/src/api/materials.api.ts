import { apiClient } from './client';

// ============ 类型定义 ============

export interface Material {
  id: string;
  file_name: string;
  size_bytes: number;
  mime_type: string | null;
  taken_at: string | null;
  created_at: string;
  /**
   * 服务端签发的临时预览地址，默认 1 小时有效。
   * 为 null 表示这一条签名失败（或服务端未配存储）——**显示占位，不要当成图片地址去加载**，
   * 否则会渲染成破图。一条坏了不影响整页，这是服务端刻意的降级。
   */
  preview_url: string | null;
}

export interface MaterialListResponse {
  items: Material[];
  limit: number;
  offset: number;
  count: number;
}

/** 服务端硬上限，传更大也会被夹到这个值。 */
export const MAX_PAGE_SIZE = 100;

// ============ 请求 ============

/**
 * 拿当前登录用户的上传凭据（license_key）。
 *
 * 素材端点认的是 `X-Upload-Token`（license_key），而 Dashboard 用的是登录态——
 * 两套鉴权对不上，所以这里先用登录态换出 license_key 再去调素材接口。
 * license_key 本来就会到浏览器（LicensePage 就在展示它），没有新增暴露面。
 */
async function getUploadToken(): Promise<string> {
  const { data } = await apiClient.get<{ license?: { license_key?: string } | null }>('/account');
  const key = data?.license?.license_key;
  if (!key) {
    throw new Error('当前账号还没有上传凭据。请先在「License」页确认账号已开通。');
  }
  return key;
}

/**
 * 列出本租户素材，最新的在前。
 *
 * 租户由服务端从凭据反查，前端传什么 tenant_id 都不作数——所以这里也不提供该参数。
 */
export async function listMaterials(
  params: { limit?: number; offset?: number } = {},
): Promise<MaterialListResponse> {
  const token = await getUploadToken();
  const { data } = await apiClient.get<{ data: MaterialListResponse }>('/materials', {
    params: { limit: params.limit, offset: params.offset },
    headers: { 'X-Upload-Token': token },
  });
  return data.data;
}

// ============ 展示辅助 ============

/** 是不是视频。mime 不可靠时（快捷指令有时传 octet-stream）退回看扩展名。 */
export function isVideo(m: Pick<Material, 'mime_type' | 'file_name'>): boolean {
  if (m.mime_type?.startsWith('video/')) return true;
  return /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(m.file_name);
}

/** 人类可读的体积。 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
