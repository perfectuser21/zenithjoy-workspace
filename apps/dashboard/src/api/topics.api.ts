/**
 * 选题池（topics）API 客户端 — 选题池 v1
 *
 * 对接 services/creator 的 `/api/topics` 路由。
 * 响应统一 `{ success, data, error }` 格式。
 */

// 注意：topics API 挂在 creator 服务（默认 /api 转到 creator）
// 单独暴露一个 baseURL，允许通过 VITE_CREATOR_API_BASE 覆盖；默认复用 /api
const CREATOR_BASE =
  (import.meta.env.VITE_CREATOR_API_BASE as string | undefined)?.replace(/\/$/, '') || ''

export type TopicStatus = '待研究' | '已通过' | '研究中' | '已发布' | '已拒绝'

export const TOPIC_STATUSES: TopicStatus[] = [
  '待研究',
  '已通过',
  '研究中',
  '已发布',
  '已拒绝',
]

export interface Topic {
  id: string
  title: string
  angle?: string | null
  priority: number
  status: TopicStatus
  target_platforms: string[]
  scheduled_date?: string | null
  pipeline_id?: string | null
  created_at: string
  updated_at: string
  published_at?: string | null
  deleted_at?: string | null
}

export interface TopicListResponse {
  items: Topic[]
  total: number
  limit: number
  offset: number
}

export interface PacingConfig {
  daily_limit: number
}

export interface CreateTopicInput {
  title: string
  angle?: string
  priority?: number
  status?: TopicStatus
  target_platforms?: string[]
  scheduled_date?: string | null
}

export interface UpdateTopicInput {
  title?: string
  angle?: string | null
  priority?: number
  status?: TopicStatus
  target_platforms?: string[]
  scheduled_date?: string | null
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
  error: null | { code: string; message: string }
}

async function api<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${CREATOR_BASE}/api/topics${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  })

  let body: ApiEnvelope<T> | { detail?: { error?: { message?: string } } } | null = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const msg =
      (body as { detail?: { error?: { message?: string } } })?.detail?.error
        ?.message ||
      (body as ApiEnvelope<T>)?.error?.message ||
      `请求失败：${res.status}`
    throw new Error(msg)
  }
  return (body as ApiEnvelope<T>).data
}

// ─── 列表 / 详情 ──────────────────────────────────────────────────

export async function listTopics(params: {
  status?: TopicStatus
  limit?: number
  offset?: number
  include_deleted?: boolean
} = {}): Promise<TopicListResponse> {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.limit !== undefined) sp.set('limit', String(params.limit))
  if (params.offset !== undefined) sp.set('offset', String(params.offset))
  if (params.include_deleted) sp.set('include_deleted', 'true')
  const qs = sp.toString()
  return api<TopicListResponse>(qs ? `?${qs}` : '')
}

export async function getTopic(id: string): Promise<Topic> {
  return api<Topic>(`/${encodeURIComponent(id)}`)
}

// ─── CRUD ────────────────────────────────────────────────────────

export async function createTopic(input: CreateTopicInput): Promise<Topic> {
  return api<Topic>('', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateTopic(
  id: string,
  input: UpdateTopicInput
): Promise<Topic> {
  return api<Topic>(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteTopic(
  id: string,
  { hard = false }: { hard?: boolean } = {}
): Promise<{ id: string; deleted: true; hard: boolean }> {
  const qs = hard ? '?hard=true' : ''
  return api(`/${encodeURIComponent(id)}${qs}`, { method: 'DELETE' })
}

// ─── pacing 配置 ─────────────────────────────────────────────────

export async function getPacingConfig(): Promise<PacingConfig> {
  return api<PacingConfig>('/pacing/config')
}

export async function updatePacingConfig(
  input: Partial<PacingConfig>
): Promise<PacingConfig> {
  return api<PacingConfig>('/pacing/config', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

// ─── 立即发布（调 apps/api pipeline/trigger）──────────────────────

export async function publishTopicNow(topic: Topic): Promise<{ id?: string }> {
  // 经由 apps/api /api/pipeline/trigger，带 topic_id
  const res = await fetch('/api/pipeline/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content_type: 'post',
      topic: topic.title,
      topic_id: topic.id,
      triggered_by: 'dashboard-topic-pool',
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `立即发布失败：${res.status}`)
  }
  const data = await res.json()
  return { id: data?.id }
}
