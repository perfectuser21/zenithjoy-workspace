import { useState, useEffect } from 'react'
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
} from 'lucide-react'

// ─── 类型 ─────────────────────────────────────────────────────

type ContentType = 'video' | 'article' | 'post'
type PipelineStatus = 'content-research' | 'content-generate' | 'content-review' | 'content-export' | 'completed' | 'failed'

interface Pipeline {
  id: string
  title: string
  status: PipelineStatus
  priority: number
  payload: {
    content_type?: string
    content_series?: string
    keyword?: string
    [key: string]: unknown
  }
  created_at: string
  started_at?: string
  completed_at?: string
}

interface ContentTypeInfo {
  id: string
  name: string
  type: ContentType
  series: string[]
}

// ─── 工具函数 ─────────────────────────────────────────────────

const CONTENT_TYPE_MAP: Record<string, { label: string; type: ContentType; icon: typeof Video }> = {
  video: { label: '视频', type: 'video', icon: Video },
  article: { label: '长文', type: 'article', icon: FileText },
  post: { label: '图文', type: 'post', icon: Image },
}

const STATUS_LABELS: Record<PipelineStatus, string> = {
  'content-research': '调研中',
  'content-generate': '生成中',
  'content-review': '待审核',
  'content-export': '导出中',
  completed: '已完成',
  failed: '失败',
}

const STATUS_COLORS: Record<PipelineStatus, string> = {
  'content-research': 'bg-blue-100 text-blue-700 border-blue-200',
  'content-generate': 'bg-purple-100 text-purple-700 border-purple-200',
  'content-review': 'bg-amber-100 text-amber-700 border-amber-200',
  'content-export': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  completed: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
}

const KANBAN_COLUMNS: { key: PipelineStatus; label: string }[] = [
  { key: 'content-research', label: '调研中' },
  { key: 'content-generate', label: '生成中' },
  { key: 'content-review', label: '待审核' },
  { key: 'completed', label: '已完成' },
]

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

// ─── API ──────────────────────────────────────────────────────

async function fetchPipelines(): Promise<Pipeline[]> {
  const res = await fetch('/api/brain/pipelines')
  if (!res.ok) throw new Error('加载失败')
  const data = await res.json()
  return data.pipelines || []
}

// ─── 看板视图 ────────────────────────────────────────────────

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  const ct = getContentType(pipeline)
  const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
  const keyword = pipeline.payload?.keyword as string | undefined
  const series = pipeline.payload?.content_series as string | undefined

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
        {pipeline.title || keyword || '未命名'}
      </div>
      {series && (
        <div className="text-xs text-gray-400 mb-1">系列：{series}</div>
      )}
      <div className="text-xs text-gray-400 mt-2 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {formatDate(pipeline.created_at)}
      </div>
    </div>
  )
}

function KanbanView({ pipelines }: { pipelines: Pipeline[] }) {
  const grouped = KANBAN_COLUMNS.map(col => ({
    ...col,
    items: pipelines.filter(p => p.status === col.key || (col.key === 'completed' && p.status === 'content-export')),
  }))

  // 视频/长文/图文分组筛选
  const [activeType, setActiveType] = useState<ContentType | 'all'>('all')

  const filtered = grouped.map(col => ({
    ...col,
    items: activeType === 'all' ? col.items : col.items.filter(p => getContentType(p) === activeType),
  }))

  return (
    <div>
      {/* 类型筛选 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveType('all')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${activeType === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          全部
        </button>
        {Object.entries(CONTENT_TYPE_MAP).map(([key, { label, icon: Icon }]) => (
          <button
            key={key}
            onClick={() => setActiveType(key as ContentType)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeType === key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 看板列 */}
      <div className="grid grid-cols-4 gap-4">
        {filtered.map(col => (
          <div key={col.key} className="bg-gray-50 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">{col.label}</span>
              <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{col.items.length}</span>
            </div>
            <div className="space-y-2">
              {col.items.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-4">暂无内容</div>
              ) : (
                col.items.map(p => <PipelineCard key={p.id} pipeline={p} />)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 排期日历 ─────────────────────────────────────────────────

function ScheduleView({ pipelines }: { pipelines: Pipeline[] }) {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  )
  const [weekOffset, setWeekOffset] = useState(0)

  // 生成本周日期列表
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7) // 周一开始

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d.toISOString().split('T')[0]
  })

  const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

  // 按日期归档 pipeline（按 created_at 日期）
  const byDate = pipelines.reduce<Record<string, Pipeline[]>>((acc, p) => {
    const date = p.created_at?.split('T')[0] || ''
    if (!acc[date]) acc[date] = []
    acc[date].push(p)
    return acc
  }, {})

  const selectedPipelines = byDate[selectedDate] || []

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      {/* 左栏：日历 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-700">
            {new Date(weekDates[0]).toLocaleDateString('zh-CN', { month: 'long' })}
          </span>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
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

      {/* 右栏：当天内容 */}
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
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-800 truncate">{p.title || p.payload?.keyword || '未命名'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{typeLabel}</span>
                      {p.payload?.content_series && <><span>·</span><span>{p.payload.content_series as string}</span></>}
                      <span>·</span>
                      <span className={`px-1.5 py-0.5 rounded border ${STATUS_COLORS[p.status] || ''}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
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

// ─── 审核队列 ─────────────────────────────────────────────────

function ReviewQueue({ pipelines }: { pipelines: Pipeline[] }) {
  const reviewItems = pipelines.filter(p => p.status === 'content-review')

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">待审核</span>
        <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">{reviewItems.length}</span>
      </div>

      {reviewItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col items-center justify-center h-48 text-gray-400">
          <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">没有待审核的内容</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviewItems.map(p => {
            const ct = getContentType(p)
            const { label: typeLabel, icon: Icon } = CONTENT_TYPE_MAP[ct] || CONTENT_TYPE_MAP.post
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-amber-200 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800">{p.title || p.payload?.keyword || '未命名'}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{typeLabel}</span>
                      {p.payload?.content_series && (
                        <span className="text-xs text-gray-400">{p.payload.content_series as string}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mb-3">
                      进入审核：{formatTime(p.started_at || p.created_at)}
                    </div>
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2">
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

type Tab = 'kanban' | 'schedule' | 'review'

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'kanban', label: '生产看板', icon: LayoutGrid },
  { key: 'schedule', label: '排期日历', icon: CalendarDays },
  { key: 'review', label: '审核队列', icon: ClipboardCheck },
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
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  const reviewCount = pipelines.filter(p => p.status === 'content-review').length

  return (
    <div className="max-w-7xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">内容工厂</h1>
          <p className="text-sm text-gray-500 mt-1">内容生产排期 · Pipeline 进度 · 审核管理</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-gray-400">{lastUpdate} 更新</span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab 栏 */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
            {key === 'review' && reviewCount > 0 && (
              <span className="ml-0.5 bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
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
          {activeTab === 'kanban' && <KanbanView pipelines={pipelines} />}
          {activeTab === 'schedule' && <ScheduleView pipelines={pipelines} />}
          {activeTab === 'review' && <ReviewQueue pipelines={pipelines} />}
        </>
      )}
    </div>
  )
}
