import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import TopicPoolTab from './content-factory/TopicPoolTab'
import { fetchPipelineStages, fetchPipelines, runPipeline, registerPipeline } from '../api/pipeline.api'
import { ScheduleView, ExecutionView } from './content-factory/PipelineViews'
import { StageProgress, CONTENT_TYPE_MAP, STATUS_COLORS, STATUS_LABELS, formatDate, getContentType, PIPELINE_STAGES, STAGE_LABELS } from './content-factory/pipeline-display'
import type { Pipeline, StageInfo } from '../api/pipeline.api'
import {
  LayoutGrid,
  CalendarDays,
  ClipboardCheck,
  ListChecks,
  RefreshCw,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Eye,
} from 'lucide-react'

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
  const [runError, setRunError] = useState('')
  const [stageError, setStageError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [stages, setStages] = useState<Record<string, StageInfo>>({})
  const [loadingStages, setLoadingStages] = useState(false)

  const handleRun = async () => {
    setRunning(true)
    setRunError('')
    try {
      if (!pipeline.cecelia_task_id) await registerPipeline(pipeline.id)
      else await runPipeline(pipeline.id)
      onRefresh?.()
    } catch (err) {
      setRunError(err instanceof Error ? err.message : '重跑失败')
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
      setStageError('')
      try { setStages(await fetchPipelineStages(pipeline.id)) }
      catch (err) { setStageError(err instanceof Error ? err.message : '阶段加载失败') }
      finally { setLoadingStages(false) }
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
          {pipeline.status === 'queued' && !pipeline.cecelia_task_id ? '待登记' : STATUS_LABELS[pipeline.status] || pipeline.status}
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
          {((!pipeline.cecelia_task_id && (pipeline.status === 'queued' || pipeline.status === 'failed')) || (pipeline.cecelia_task_id && (pipeline.status === 'failed' || pipeline.status === 'completed'))) && (
            <button
              onClick={handleRun}
              disabled={running}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {running ? '登记中' : pipeline.cecelia_task_id ? '重新排队' : '重试挂号'}
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
      {stageError && <p role="alert" className="text-xs text-red-600 mt-2">{stageError}</p>}
      {runError && <p role="alert" className="text-xs text-red-600 mt-2">{runError}</p>}
      {expanded && (
        <StageDetailView stages={stages} loading={loadingStages} />
      )}
    </div>
  )
}

// ─── 看板视图 ────────────────────────────────────────────────

function KanbanView({ pipelines, onRefresh }: { pipelines: Pipeline[]; onRefresh?: () => void }) {
  const columns = [
    { label: '待认领', filter: (p: Pipeline) => p.status === 'queued' },
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

type Tab = 'topic-pool' | 'kanban' | 'schedule' | 'execution'

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'topic-pool', label: '选题池', icon: ListChecks },
  { key: 'kanban', label: '生产看板', icon: LayoutGrid },
  { key: 'schedule', label: '排期日历', icon: CalendarDays },
  { key: 'execution', label: '执行状态', icon: ClipboardCheck },
]

export default function ContentFactoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('topic-pool')
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
      setError('加载失败，请检查内容工厂服务')
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

      {activeTab !== 'topic-pool' && <button onClick={() => setActiveTab('topic-pool')} className="mb-4 text-sm text-indigo-700">从选题池登记内容任务</button>}

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); if (key !== 'topic-pool') load() }}
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
          {activeTab === 'topic-pool' && <TopicPoolTab />}
          {activeTab === 'kanban' && <KanbanView pipelines={pipelines} onRefresh={load} />}
          {activeTab === 'schedule' && <ScheduleView pipelines={pipelines} />}
          {activeTab === 'execution' && <ExecutionView pipelines={pipelines} />}
        </>
      )}
    </div>
  )
}
