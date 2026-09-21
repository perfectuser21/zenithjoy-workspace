import { apiClient } from './client';

// ============ 类型定义 ============

/**
 * 素材 AI 打标签状态三态（与 apps/api/db/migrations/20260919_000000_materials_ai_tags.sql
 * 及 material-tagging.ts 的 TagStatus 对齐）。没有"识别中"这一态——服务端排队处理完
 * 直接落终态：
 *  - pending                = 还没处理（刚上传/还在排队）
 *  - tagged                 = 已识别，ai_tags/ai_description 有值
 *  - failed_pending_review  = 处理失败/人工复核中（抽帧失败、缺 key、超时、解析不出标签）
 *
 * 只有 tag_status === 'tagged' 的素材能进混剪选择页（MashupPage taggedMaterials 过滤），
 * 所以这个字段客户必须在素材库页面上看得见。
 *
 * Material.tag_status 字段本身仍按 string 收纳（而不是这个字面量联合类型）——
 * MashupPage.tsx 已有 `TaggedMaterial = Material & { tag_status?: string }` 这层历史
 * 类型叠加，字段类型收得太窄会在那边（不属于本次改动范围）炸出交叉类型冲突。
 * 展示层（getTagStatusMeta）按这三个字面量值做 switch，未知值兜底按"待识别"处理。
 */
export type TagStatus = 'pending' | 'tagged' | 'failed_pending_review';

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
  /** AI 打标签状态三态，见 TagStatus 的说明。 */
  tag_status: string;
  /** 识别出的标签列表。tag_status 不是 tagged 时通常是空数组（服务端保证不返回 null）。 */
  ai_tags: string[];
}

export interface MaterialListResponse {
  items: Material[];
  limit: number;
  offset: number;
  count: number;
}

export interface MaterialPreview {
  materialId: string;
  /** 现签的临时地址；null = 签发失败（storage_key 失效/未配存储）。 */
  previewUrl: string | null;
  /** 服务端按 mime 判的"可播"。前端不拿它当播放开关——见 getMaterialPreview 注释。 */
  previewAvailable: boolean;
  expiresAt: string;
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
  const { data } = await apiClient.get<{ license?: { license_key?: string } | null }>('/account/me');
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

/**
 * 打开详情弹窗时现签一个预览地址。
 *
 * 不复用列表里的 preview_url：那是列表渲染时签的，TTL 1 小时、前端还缓存 5 分钟，
 * 弹窗打开那一刻可能已经过期，<video> 拿到过期 URL 只会黑屏。
 */
export async function getMaterialPreview(materialId: string): Promise<MaterialPreview> {
  const token = await getUploadToken();
  const { data } = await apiClient.get<{ data: MaterialPreview }>(
    `/materials/${materialId}/preview`,
    { headers: { 'X-Upload-Token': token } },
  );
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
