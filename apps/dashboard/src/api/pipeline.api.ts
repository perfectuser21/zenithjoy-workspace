export type PipelineStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'quarantined'
export interface Pipeline {
  id: string
  cecelia_task_id?: string | null
  title: string
  status: PipelineStatus
  priority: string
  payload: { content_type?: string; keyword?: string; notebook_id?: string; [key: string]: unknown }
  created_at: string
  started_at?: string
  completed_at?: string
}
export interface PipelineRegistration {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  cecelia_task_id: string
}
export interface StageInfo {
  status: string
  started_at?: string
  completed_at?: string
  error?: string
  error_message?: string
}
export interface WorkerCapability {
  content_type: string
  label: string
  stages: string[]
  notebook_source: string
}

export interface PipelineErrorDetails {
  pipeline_run_id?: string
  registration_status?: 'unknown' | 'rejected'
}
export class PipelineApiError extends Error {
  readonly details: PipelineErrorDetails
  constructor(body: unknown, fallback: string) {
    const error = body && typeof body === 'object' ? (body as {error?: unknown}).error : null
    const structured = error && typeof error === 'object' ? error as {message?: unknown; details?: unknown} : null
    super(typeof error === 'string' ? error : typeof structured?.message === 'string' ? structured.message : fallback)
    this.name = 'PipelineApiError'
    const details = structured?.details && typeof structured.details === 'object' ? structured.details as PipelineErrorDetails : {}
    this.details = {
      ...(typeof details.pipeline_run_id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(details.pipeline_run_id) ? {pipeline_run_id:details.pipeline_run_id} : {}),
      ...(['unknown','rejected'].includes(details.registration_status || '') ? {registration_status:details.registration_status} : {}),
    }
  }
}
export async function readPipelineResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success === false) throw new PipelineApiError(body, fallback)
  return (body?.success === true ? body.data : body) as T
}

export async function fetchWorkerCapability(): Promise<WorkerCapability> {
  const capability = await readPipelineResponse<WorkerCapability>(await fetch('/api/pipeline/capabilities'), '内容执行器信息加载失败')
  if (!capability?.content_type || !Array.isArray(capability.stages) || !capability.stages.length) throw new Error('内容执行器信息不完整')
  return capability
}
export async function fetchPipelines(): Promise<Pipeline[]> {
  const runs = await readPipelineResponse<Record<string, unknown>[]>(await fetch('/api/pipeline'), '内容任务加载失败')
  if (!Array.isArray(runs)) throw new Error('内容任务列表格式错误')
  return runs.map(run => ({
    id: run.id as string, cecelia_task_id: run.cecelia_task_id as string | null | undefined, title: (run.topic as string) || (run.content_type as string) || '未命名',
    status: run.status === 'pending' ? 'queued' : run.status === 'running' ? 'in_progress' : run.status as PipelineStatus,
    priority: 'P2', payload: {content_type: run.content_type as string, keyword: run.topic as string},
    created_at: run.created_at as string, started_at: run.started_at as string | undefined, completed_at: run.completed_at as string | undefined,
  }))
}
export async function runPipeline(id: string): Promise<void> {
  const run = await readPipelineResponse<{id?: string; status?: string; cecelia_task_id?: string}>(await fetch(`/api/pipeline/${encodeURIComponent(id)}/rerun`, {method:'POST'}), '重跑登记失败')
  if (!run?.id || run.status !== 'pending' || !run.cecelia_task_id) throw new Error('未取得新的 Brain 任务登记回执')
}
export async function fetchPipelineStages(id: string): Promise<Record<string, StageInfo>> {
  const data = await readPipelineResponse<{stages?: Record<string, StageInfo>}>(await fetch(`/api/pipeline/${encodeURIComponent(id)}/stages`), '阶段信息加载失败')
  const aliases: Record<string, string> = {'content-research':'research','content-copywriting':'copywriting','content-copy-review':'copy_review','content-generate':'generate','content-image-review':'image_review','content-export':'export'}
  return Object.fromEntries(Object.entries(data.stages || {}).map(([key, stage]) => [aliases[key] || key, stage]))
}

export async function registerPipeline(id: string): Promise<PipelineRegistration> {
  const run = await readPipelineResponse<{id?: string; status?: string; cecelia_task_id?: string}>(await fetch(`/api/pipeline/${encodeURIComponent(id)}/register`, {method:'POST'}), '任务挂号重试失败')
  if (run?.id !== id || run.status !== 'pending' || !run.cecelia_task_id) throw new Error('未取得同一任务的 Brain 登记回执')
  return run as PipelineRegistration
}
