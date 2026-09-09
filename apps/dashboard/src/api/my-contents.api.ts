import { apiClient } from './client';

// ============ 类型定义 ============

/**
 * 与 apps/api `zenithjoy.contents.status` 对齐（见 20260511 迁移 + publish-dispatch.ts）。
 * queued＝排队中不可编辑；failed 允许对失败子集平台重发。
 */
export type MyContentStatus = 'draft' | 'queued' | 'published' | 'failed';

export interface ContentReceipt {
  platform: string;
  /** publish_tasks.status 原样透传：done/failed/pending/queued/dispatched/in_progress/running。 */
  status: string;
}

export interface ContentMaterialPreview {
  file_name: string;
  /** 仅首图签名 URL；签名失败或未配存储时为 null——显示占位，不要塞进 <img src> 渲染成破图。 */
  preview_url: string | null;
}

export interface MyContent {
  id: string;
  title: string | null;
  body: string | null;
  type: string;
  platforms: string[];
  status: MyContentStatus;
  created_at: string;
  materials: ContentMaterialPreview[];
  receipts: ContentReceipt[];
}

export interface MyContentListResponse {
  items: MyContent[];
}

// ============ 请求 ============

/**
 * 拿当前登录用户的上传凭据（license_key）。
 *
 * /api/contents 系列端点认的是 `X-Upload-Token`（license_key），照 materials.api.ts 的
 * getUploadToken 模式：Dashboard 用登录态换出 license_key 再去调。
 */
async function getUploadToken(): Promise<string> {
  const { data } = await apiClient.get<{ license?: { license_key?: string } | null }>('/account');
  const key = data?.license?.license_key;
  if (!key) {
    throw new Error('当前账号还没有上传凭据。请先在「License」页确认账号已开通。');
  }
  return key;
}

/** 列出本租户作品，最新的在前。租户由服务端从凭据反查，前端不传 tenant_id。 */
export async function listMyContents(
  params: { status?: string } = {},
): Promise<MyContentListResponse> {
  const token = await getUploadToken();
  const { data } = await apiClient.get<{ data: MyContentListResponse }>('/contents', {
    params: { status: params.status },
    headers: { 'X-Upload-Token': token },
  });
  return data.data;
}

/**
 * 编辑作品。status='queued'（排队中）服务端会拒绝并返回 409 EDIT_LOCKED——前端应在
 * queued 状态下不给编辑入口，而不是等这个 409。
 */
export async function updateMyContent(
  id: string,
  patch: { title?: string; body?: string; platforms?: string[] },
): Promise<void> {
  const token = await getUploadToken();
  await apiClient.patch(`/contents/${id}`, patch, {
    headers: { 'X-Upload-Token': token },
  });
}

/**
 * 发布 / 重发。不传 platforms → 按作品原有 platforms 整单发布；传子集 → 只对这个子集重派。
 *
 * **重发失败平台场景禁止整单重派**：调用方必须只传 receipts 里 status≠'done' 的平台，
 * 否则已经发布成功的平台会被二次派发（双发）。这条子集语义由服务端 CAS 兜底，
 * 但前端必须先做对，别指望服务端替你过滤。
 */
export async function publishMyContent(id: string, platforms?: string[]): Promise<unknown> {
  const token = await getUploadToken();
  const body = platforms !== undefined ? { platforms } : {};
  const { data } = await apiClient.post(`/contents/${id}/publish`, body, {
    headers: { 'X-Upload-Token': token },
  });
  return data.data;
}
