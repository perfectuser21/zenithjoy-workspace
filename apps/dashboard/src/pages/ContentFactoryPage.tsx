import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  CalendarDays,
  ClipboardCheck,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Video,
  FileText,
  Image,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Eye,
  Plus,
  Search,
  X,
} from 'lucide-react'

// ─── 类型 ─────────────────────────────────────────────────────

type ContentType = 'video' | 'article' | 'post'
type PipelineStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'quarantined'

interface Pipeline {
  id: string
  title: string
  status: PipelineStatus
  priority: string
  payload: {
    content_type?: string
    keyword?: string
    notebook_id?: string
    angle?: string
    [key: string]: unknown
  }
  created_at: string
  started_at?: string
  completed_at?: string
}

interface StageInfo {
  status: string
  started_at?: string
  completed_at?: string
  error?: string
  error_message?: string
}

const PIPELINE_STAGES = ['content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review', 'content-export'] as const
const STAGE_LABELS: Record<string, string> = {
  'content-research': '调研',
  'content-copywriting': '文案',
  'content-copy-review': '文案审核',
  'content-generate': '图片',
  'content-image-review': '图片审核',
  'content-export': '导出',
}

// ─── 工具函数 ─────────────────────────────────────────────────

const CONTENT_TYPE_MAP: Record<string, { label: string; type: ContentType; icon: typeof Video }> = {
  video: { label: '视频', type: 'video', icon: Video },
  article: { label: '长文', type: 'article', icon: FileText },
  post: { label: '图文', type: 'post', icon: Image },
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
  quarantined: '已暂停',
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  quarantined: 'bg-amber-100 text-amber-700 border-amber-200',
}

function getContentType(p: Pipeline): ContentType {
  const ct = p.payload?.content_type || ''
  if (ct.includes('video')) return 'video'
  if (ct.includes('article') || ct.includes('long')) return 'article'
  return 'post'
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getStageStatuses(pipelineStatus: PipelineStatus): ('pending' | 'active' | 'done' | 'failed')[] {
  const n = PIPELINE_STAGES.length
  if (pipelineStatus === 'queued') return Array(n).fill('pending') as 'pending'[]
  if (pipelineStatus === 'completed') return Array(n).fill('done') as 'done'[]
  if (pipelineStatus === 'failed' || pipelineStatus === 'quarantined') return Array(n).fill('pending') as 'pending'[]
  return ['active', ...Array(n - 1).fill('pending')] as ('active' | 'pending')[]
}

// ─── API ──────────────────────────────────────────────────────

async function fetchPipelines(): Promise<Pipeline[]> {
  const res = await fetch('/api/pipeline')
  if (!res.ok) throw new Error('加载失败')
  const runs: Record<string, unknown>[] = await res.json()
  return runs.map(r => ({
    id: r.id as string,
    title: (r.topic as string) || (r.content_type as string) || '未命名',
    status: r.status === 'pending' ? 'queued' : r.status === 'running' ? 'in_progress' : r.status as PipelineStatus,
    priority: 'P2',
    payload: { content_type: r.content_type as string, keyword: r.topic as string },
    created_at: r.created_at as string,
  }))
}

async function fetchContentTypes(): Promise<string[]> {
  const res = await fetch('/api/brain/content-types')
  if (!res.ok) return []
  return res.json()
}

async function fetchContentTypeConfig(type: string): Promise<{ notebook_id?: string } | null> {
  const res = await fetch(`/api/brain/content-types/${encodeURIComponent(type)}/config`)
  if (!res.ok) return null
  const data = await res.json()
  return data.config || null
}

async function createPipeline(params: {
  keyword: string
  content_type: string
  priority?: string
  platforms?: string[]
  notebook_id?: string
}): Promise<Pipeline> {
  const res = await fetch('/api/pipeline/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: params.content_type, topic: params.keyword, triggered_by: 'manual' }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '创建失败' }))
    throw new Error(err.error || '创建失败')
  }
  const r = await res.json()
  return {
    id: r.id,
    title: r.topic || r.content_type || '未命名',
    status: r.status === 'pending' ? 'queued' : r.status === 'running' ? 'in_progress' : r.status,
    priority: 'P2',
    payload: { content_type: r.content_type, keyword: r.topic },
    created_at: r.created_at,
  }
}

async function runPipeline(id: string): Promise<void> {
  const res = await fetch(`/api/pipeline/${id}/rerun`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '执行失败' }))
    throw new Error(err.error || '执行失败')
  }
}

async function fetchPipelineStages(id: string): Promise<Record<string, StageInfo>> {
  const res = await fetch(`/api/pipeline/${id}/stages`)
  if (!res.ok) return {}
  const data = await res.json()
  return data.stages || {}
}

const ALL_PLATFORMS = [
  { id: 'douyin', label: '抖音' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'wechat', label: '公众号' },
  { id: 'zhihu', label: '知乎' },
  { id: 'weibo', label: '微博' },
  { id: 'toutiao', label: '头条' },
  { id: 'kuaishou', label: '快手' },
  { id: 'shipinhao', label: '视频号' },
]

// ─── 阶段进度条 ────────────────────────────────────────────────

function StageProgress({ status }: { status: PipelineStatus }) {
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

// ─── 创建 Pipeline 表单 ─────────────────────────────────────────

function CreatePipelineForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [contentType, setContentType] = useState('')
  const [notebookId, setNotebookId] = useState('')
  const [angle, setAngle] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['douyin', 'xiaohongshu', 'wechat'])
  const [contentTypes, setContentTypes] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    fetchContentTypes().then(types => {
      setContentTypes(types)
      if (types.length > 0 && !contentType) setContentType(types[0])
    })
  }, [])

  // 选内容类型后自动从配置带入 notebook_id
  useEffect(() => {
    if (!contentType) return
    fetchContentTypeConfig(contentType).then(cfg => {
      setNotebookId(cfg?.notebook_id || '')
    })
  }, [contentType])

  const handleCreate = async () => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      setCreateError('关键词不能为空')
      return
    }
    if (!contentType) {
      setCreateError('请选择内容系列')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      await createPipeline({ keyword: trimmed, content_type: contentType, platforms, notebook_id: notebookId || undefined })
      setKeyword('')
      setAngle('')
      setNotebookId('')
      setOpen(false)
      onCreated()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 mb-6 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
        新建 Pipeline
      </button>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">新建内容 Pipeline</h3>
        <button onClick={() => { setOpen(false); setCreateError('') }} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            关键词 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={e => { setKeyword(e.target.value); setCreateError('') }}
              placeholder="如：马斯克、Dan Koe、八平台分发"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            内容系列 <span className="text-red-500">*</span>
          </label>
          <select
            value={contentType}
            onChange={e => { setContentType(e.target.value); setCreateError('') }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-white"
          >
            <option value="">选择系列...</option>
            {contentTypes.map(ct => (
              <option key={ct} value={ct}>{ct}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            NotebookLM ID
            {notebookId ? (
              <span className="ml-1 text-xs text-green-600 font-normal">（已从内容类型配置自动填入）</span>
            ) : (
              <span className="text-gray-400 font-normal"> (可选)</span>
            )}
          </label>
          <input
            type="text"
            value={notebookId}
            onChange={e => setNotebookId(e.target.value)}
            placeholder="选择内容类型后自动填入，或手动输入"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            切入角度 <span className="text-gray-400 font-normal">(可选)</span>
          </label>
          <input
            type="text"
            value={angle}
            onChange={e => setAngle(e.target.value)}
            placeholder="如：能力密度、极致效率"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>
      </div>

      <div className="mt-4">
          <label className="block text-xs font-medium text-gray-600 mb-2">
            目标平台
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_PLATFORMS.map(p => {
              const selected = platforms.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatforms(prev =>
                    selected ? prev.filter(x => x !== p.id) : [...prev, p.id]
                  )}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selected
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

      {createError && (
        <div className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {createError}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {creating ? '创建中...' : '创建 Pipeline'}
        </button>
      </div>
    </div>
  )
}

// ─── Stage 详情视图 ─────────────────────────────────────────────

function StageDetailView({ stages, loading }: { stages: Record<string, StageInfo>; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400 mr-2" />
        <span className="text-xs text-gray-400">加载阶段详情...</span>
      </div>
    )
  }

  const stageOrder = PIPELINE_STAGES

  const formatDuration = (start?: string, end?: string) => {
    if (!start) return null
    const s = new Date(start).getTime()
    const e = end ? new Date(end).getTime() : Date.now()
    const secs = Math.round((e - s) / 1000)
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m${secs % 60}s`
  }

  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
    if (status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
    if (status === 'in_progress') return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin flex-shrink-0" />
    return <div className="w-3.5 h-3.5 rounded-full border border-gray-200 flex-shrink-0" />
  }

  const hasAnyStage = stageOrder.some(s => stages[s])

  if (!hasAnyStage) {
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center py-2">暂无阶段数据</p>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
      {stageOrder.map(stageKey => {
        const stage = stages[stageKey]
        const label = STAGE_LABELS[stageKey]
        const status = stage?.status || 'pending'
        const duration = stage ? formatDuration(stage.started_at, stage.completed_at) : null
        const errorMsg = stage?.error || stage?.error_message

        return (
          <div key={stageKey} className="flex items-start gap-2 py-1">
            {statusIcon(status)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-700">{label}</span>
                {duration && (
                  <span className="text-xs text-gray-400 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" />{duration}
                  </span>
                )}
              </div>
              {status === 'failed' && errorMsg && (
                <p className="text-xs text-red-500 mt-0.5 break-words">{errorMsg}</p>
              )}
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
              status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
              status === 'failed' ? 'bg-red-50 text-red-700 border-red-200' :
              status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
              'bg-gray-50 text-gray-500 border-gray-200'
            }`}>
              {status === 'completed' ? '完成' : status === 'failed' ? '失败' : status === 'in_progress' ? '进行中' : '待执行'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Pipeline 卡片 ─────────────────────────────────────────────

function PipelineCard({ pipeline, onRefresh }: { pipeline: Pipeline; onRefresh?: () => void }) {
  const ct = getContentType(pipeline)
  const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
  const keyword = pipeline.payload?.keyword as string | undefined
  const navigate = useNavigate()
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [stages, setStages] = useState<Record<string, StageInfo>>({})
  const [loadingStages, setLoadingStages] = useState(false)

  const handleRun = async () => {
    setRunning(true)
    try {
      await runPipeline(pipeline.id)
      onRefresh?.()
    } catch {
      // 静默处理
    } finally {
      setRunning(false)
    }
  }

  const handlePreview = () => {
    navigate(`/content-factory/${pipeline.id}/output`)
  }

  const handleToggleExpand = async () => {
    if (!expanded && Object.keys(stages).length === 0) {
      setLoadingStages(true)
      const data = await fetchPipelineStages(pipeline.id)
      setStages(data)
      setLoadingStages(false)
    }
    setExpanded(prev => !prev)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          <Icon className="w-3 h-3" />
          {typeLabel}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[pipeline.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
          {STATUS_LABELS[pipeline.status] || pipeline.status}
        </span>
      </div>
      <div className="text-sm font-medium text-gray-800 mb-1 line-clamp-2">
        {keyword || pipeline.title || '未命名'}
      </div>
      {pipeline.payload?.content_type && (
        <div className="text-xs text-gray-400 mb-0.5">{pipeline.payload.content_type}</div>
      )}
      <StageProgress status={pipeline.status} />
      <div className="flex items-center justify-between mt-2">
        <div className="text-xs text-gray-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDate(pipeline.created_at)}
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleToggleExpand}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-50 text-gray-500 rounded-md hover:bg-gray-100 transition-colors border border-gray-100"
          >
            {loadingStages ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            {expanded ? '收起' : '步骤'}
          </button>
          {pipeline.status === 'queued' && (
            <button
              onClick={handleRun}
              disabled={running}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {running ? '执行中' : '开始执行'}
            </button>
          )}
          {pipeline.status === 'completed' && (
            <button
              onClick={handlePreview}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 rounded-md hover:bg-green-100 transition-colors"
            >
              <Eye className="w-3 h-3" />
              查看产出
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <StageDetailView stages={stages} loading={loadingStages} />
      )}
    </div>
  )
}

// ─── 看板视图 ────────────────────────────────────────────────

function KanbanView({ pipelines, onRefresh }: { pipelines: Pipeline[]; onRefresh?: () => void }) {
  const columns = [
    { label: '排队中', filter: (p: Pipeline) => p.status === 'queued' },
    { label: '进行中', filter: (p: Pipeline) => p.status === 'in_progress' },
    { label: '已完成', filter: (p: Pipeline) => p.status === 'completed' },
    { label: '异常', filter: (p: Pipeline) => p.status === 'failed' || p.status === 'quarantined' },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {columns.map((col, ci) => {
        const items = pipelines.filter(col.filter)
        return (
          <div key={ci} className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">{col.label}</span>
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无</div>
              ) : (
                items.map(p => <PipelineCard key={p.id} pipeline={p} onRefresh={onRefresh} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── 排期日历 ─────────────────────────────────────────────────

function ScheduleView({ pipelines }: { pipelines: Pipeline[] }) {
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

  const byDate = pipelines.reduce<Record<string, Pipeline[]>>((acc, p) => {
    const date = p.created_at?.split('T')[0] || ''
    if (!acc[date]) acc[date] = []
    acc[date].push(p)
    return acc
  }, {})

  const selectedPipelines = byDate[selectedDate] || []

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-700">
            {new Date(weekDates[0]).toLocaleDateString('zh-CN', { month: 'long' })}
          </span>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          {weekDates.map((date, i) => {
            const count = (byDate[date] || []).length
            const isToday = date === new Date().toISOString().split('T')[0]
            const isSelected = date === selectedDate
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${isSelected ? 'bg-indigo-600 text-white' : 'hover:bg-gray-50 text-gray-700'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isSelected ? 'text-indigo-200' : 'text-gray-400'}`}>周{DAY_LABELS[i]}</span>
                  <span className={isToday && !isSelected ? 'font-bold text-indigo-600' : ''}>
                    {new Date(date + 'T12:00:00').getDate()}日
                  </span>
                </div>
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-indigo-500 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-4">
          {new Date(selectedDate + 'T12:00:00').toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
          <span className="ml-2 text-gray-400 text-xs">共 {selectedPipelines.length} 项</span>
        </h3>
        {selectedPipelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <CalendarDays className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">当天没有排期内容</p>
          </div>
        ) : (
          <div className="space-y-3">
            {selectedPipelines.map(p => {
              const ct = getContentType(p)
              const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
              return (
                <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-indigo-200 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-800 truncate block">{p.title || p.payload?.keyword || '未命名'}</span>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      <span>{typeLabel}</span>
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded border ${STATUS_COLORS[p.status] || ''}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
                    <StageProgress status={p.status} />
                  </div>
                  <div className="text-xs text-gray-400 flex-shrink-0">{formatTime(p.started_at || p.created_at)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 执行状态 ─────────────────────────────────────────────────

function ExecutionView({ pipelines }: { pipelines: Pipeline[] }) {
  const activeItems = pipelines.filter(p => p.status === 'in_progress' || p.status === 'queued')

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">执行中 / 排队中</span>
        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">{activeItems.length}</span>
      </div>

      {activeItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center h-48 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">没有进行中的 Pipeline</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeItems.map(p => {
            const ct = getContentType(p)
            const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-blue-200 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800">{p.title || p.payload?.keyword || '未命名'}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{typeLabel}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mb-3">
                      开始：{formatTime(p.started_at || p.created_at)}
                    </div>
                    <StageProgress status={p.status} />
                    <div className="flex items-center gap-2 mt-3">
                      <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                        <Eye className="w-3.5 h-3.5" />
                        预览
                      </button>
                      <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                        <ThumbsUp className="w-3.5 h-3.5" />
                        通过
                      </button>
                      <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors">
                        <ThumbsDown className="w-3.5 h-3.5" />
                        打回
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── 主页面 ─────────────────────────────────────────────────────

type Tab = 'kanban' | 'schedule' | 'execution'

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'kanban', label: '生产看板', icon: LayoutGrid },
  { key: 'schedule', label: '排期日历', icon: CalendarDays },
  { key: 'execution', label: '执行状态', icon: ClipboardCheck },
]

export default function ContentFactoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('kanban')
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdate, setLastUpdate] = useState('')

  const load = async () => {
    try {
      setLoading(true)
      const data = await fetchPipelines()
      setPipelines(data)
      setError('')
      setLastUpdate(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch {
      setError('加载失败，请检查 Brain 服务是否运行')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // 有排队或进行中 pipeline 时 5 秒轮询，否则 30 秒
  useEffect(() => {
    const hasActive = pipelines.some(p => p.status === 'in_progress' || p.status === 'queued')
    const interval = hasActive ? 5000 : 30000
    const t = setInterval(load, interval)
    return () => clearInterval(t)
  }, [pipelines])

  const activeCount = pipelines.filter(p => p.status === 'in_progress' || p.status === 'queued').length

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">内容工厂</h1>
          <p className="text-sm text-gray-500 mt-1">内容生产排期 · Pipeline 进度 · 执行管理</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && <span className="text-xs text-gray-400">{lastUpdate} 更新</span>}
          <button
            onClick={load}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <CreatePipelineForm onCreated={load} />

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === key ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {key === 'execution' && activeCount > 0 && (
              <span className="ml-0.5 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">{activeCount}</span>
            )}
          </button>
        ))}
      </div>

      {loading && pipelines.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : error && pipelines.length === 0 ? (
        <div className="flex items-center justify-center h-64 gap-2 text-red-500">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      ) : (
        <>
          {activeTab === 'kanban' && <KanbanView pipelines={pipelines} onRefresh={load} />}
          {activeTab === 'schedule' && <ScheduleView pipelines={pipelines} />}
          {activeTab === 'execution' && <ExecutionView pipelines={pipelines} />}
        </>
      )}
    </div>
  )
}
