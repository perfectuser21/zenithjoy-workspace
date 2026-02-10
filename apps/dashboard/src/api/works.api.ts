import { apiClient } from './client';

// ============ 类型定义 ============

export type ContentType = 'text' | 'image' | 'video' | 'article' | 'audio';
export type WorkStatus = 'draft' | 'pending' | 'published' | 'archived';
export type Account = 'XXIP' | 'XXAI';
export type Platform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'weibo' | 'bilibili' | 'toutiao' | 'channels' | 'zhihu';

export interface Work {
  id: string;
  title: string;
  content_type: ContentType;
  status: WorkStatus;
  account: Account;
  content_text?: string;
  media_files?: Array<{ url: string; type: 'image' | 'video'; }>;
  custom_fields?: Record<string, any>;
  created_at: string;
  updated_at: string;
  first_published_at?: string;
  archived_at?: string;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface WorkFilters {
  type?: ContentType;
  status?: WorkStatus;
  account?: Account;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: 'created_at' | 'updated_at' | 'first_published_at' | 'title';
  order?: 'asc' | 'desc';
}

export interface CreateWorkInput {
  title: string;
  content_type: ContentType;
  account?: Account;
  status?: WorkStatus;
  content_text?: string;
  media_files?: Array<{ url: string; type: 'image' | 'video'; }>;
  custom_fields?: Record<string, any>;
}

export interface UpdateWorkInput {
  title?: string;
  content_type?: ContentType;
  account?: Account;
  status?: WorkStatus;
  content_text?: string;
  media_files?: Array<{ url: string; type: 'image' | 'video'; }>;
  custom_fields?: Record<string, any>;
}

// ============ API 函数 ============

// 获取作品列表
export async function getWorks(filters?: WorkFilters): Promise<ListResponse<Work>> {
  const response = await apiClient.get<ListResponse<Work>>('/works', { params: filters });
  return response.data;
}

// 获取单个作品
export async function getWork(id: string): Promise<Work> {
  const response = await apiClient.get<Work>(`/works/${id}`);
  return response.data;
}

// 创建作品
export async function createWork(work: CreateWorkInput): Promise<Work> {
  const response = await apiClient.post<Work>('/works', work);
  return response.data;
}

// 更新作品
export async function updateWork(id: string, updates: UpdateWorkInput): Promise<Work> {
  const response = await apiClient.put<Work>(`/works/${id}`, updates);
  return response.data;
}

// 删除作品
export async function deleteWork(id: string): Promise<void> {
  await apiClient.delete(`/works/${id}`);
}

// 发布记录相关
export interface PublishLog {
  id: string;
  work_id: string;
  platform: Platform;
  platform_post_id?: string;
  platform_url?: string;
  scheduled_at?: string;
  published_at?: string;
  status: 'scheduled' | 'publishing' | 'success' | 'failed';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// 获取作品的发布记录
export async function getPublishLogs(workId: string): Promise<PublishLog[]> {
  const response = await apiClient.get<PublishLog[]>(`/works/${workId}/publish-logs`);
  return response.data;
}

// 创建发布记录
export async function createPublishLog(workId: string, log: {
  platform: Platform;
  scheduled_at?: string;
}): Promise<PublishLog> {
  const response = await apiClient.post<PublishLog>(`/works/${workId}/publish-logs`, log);
  return response.data;
}

// 更新发布记录
export async function updatePublishLog(id: string, updates: {
  platform_post_id?: string;
  platform_url?: string;
  published_at?: string;
  status?: 'scheduled' | 'publishing' | 'success' | 'failed';
  error_message?: string;
}): Promise<PublishLog> {
  const response = await apiClient.put<PublishLog>(`/publish-logs/${id}`, updates);
  return response.data;
}
