import { Video, FileText, Image } from 'lucide-react'
import type { Pipeline } from '../../api/pipeline.api'

// ─── 类型 ─────────────────────────────────────────────────────

export type ContentType = 'video' | 'article' | 'post'
export type PipelineStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'quarantined'

export const PIPELINE_STAGES = ['research', 'copywriting', 'copy_review', 'generate', 'image_review', 'export'] as const
export const STAGE_LABELS: Record<string, string> = {
  'research': '调研',
  'copywriting': '文案',
  'copy_review': '文案审核',
  'generate': '图片',
  'image_review': '图片审核',
  'export': '导出',
}

// ─── 工具函数 ─────────────────────────────────────────────────

export const CONTENT_TYPE_MAP: Record<string, { label: string; type: ContentType; icon: typeof Video }> = {
  video: { label: '视频', type: 'video', icon: Video },
  article: { label: '长文', type: 'article', icon: FileText },
  post: { label: '图文', type: 'post', icon: Image },
}

export const STATUS_LABELS: Record<string, string> = {
  queued: '待认领',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  quarantined: '已暂停',
}

export const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  quarantined: 'bg-amber-100 text-amber-700 border-amber-200',
}

export function getContentType(p: Pipeline): ContentType {
  const ct = p.payload?.content_type || ''
  if (ct.includes('video')) return 'video'
  if (ct.includes('article') || ct.includes('long')) return 'article'
  return 'post'
}

export function formatDate(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function formatTime(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getStageStatuses(pipelineStatus: PipelineStatus): ('pending' | 'active' | 'done' | 'failed')[] {
  const n = PIPELINE_STAGES.length
  if (pipelineStatus === 'queued') return Array(n).fill('pending') as 'pending'[]
  if (pipelineStatus === 'completed') return Array(n).fill('done') as 'done'[]
  if (pipelineStatus === 'failed' || pipelineStatus === 'quarantined') return Array(n).fill('pending') as 'pending'[]
  return Array(n).fill('pending') as 'pending'[]
}

export function StageProgress({ status }: { status: PipelineStatus }) {
  const stages = getStageStatuses(status)
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        {PIPELINE_STAGES.map((stage, i) => {
          const s = stages[i]
          const color = s === 'done' ? 'bg-green-500' : s === 'active' ? 'bg-blue-500 animate-pulse' : s === 'failed' ? 'bg-red-500' : 'bg-gray-200'
          return <div key={stage} className={`h-1.5 rounded-full flex-1 ${color}`} />
        })}
      </div>
      <div className="flex items-center gap-1 mt-1">
        {PIPELINE_STAGES.map((stage) => (
          <div key={stage} className="flex-1 text-center">
            <span className="text-[10px] text-gray-400">{STAGE_LABELS[stage]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

