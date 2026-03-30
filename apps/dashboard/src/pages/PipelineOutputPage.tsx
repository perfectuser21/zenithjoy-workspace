import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Image as ImageIcon,
  FileText,
  BookOpen,
  Layers,
  FolderOpen,
  Send,
} from 'lucide-react'

// ─── 类型 ─────────────────────────────────────────────────────

interface ImageItem {
  type: 'cover' | 'card'
  index?: number
  url: string
}

interface PipelineOutput {
  keyword: string
  status: string
  article_text: string | null
  cards_text: string | null
  image_urls: ImageItem[]
  export_path?: string
}

interface StageInfo {
  status: string
  started_at?: string
  completed_at?: string
  review_issues?: unknown[]
  review_passed?: boolean
}

// ─── 工具函数 ─────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'content-export',
  'content-publish',
] as const

const STAGE_LABELS: Record<string, string> = {
  'content-research': '调研',
  'content-copywriting': '文案生成',
  'content-copy-review': '文案审核',
  'content-generate': '图片生成',
  'content-image-review': '图片审核',
  'content-export': '导出',
  'content-publish': '发布',
}

function formatDuration(start?: string, end?: string): string {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const ms = e - s
  if (ms < 1000) return '< 1s'
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m${secs % 60}s`
}

// 简单的 markdown 渲染（加粗、斜体、标题、段落）
function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-800 dark:text-slate-200 mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-slate-900 dark:text-white mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 dark:text-white mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-violet-300 dark:border-violet-700 pl-4 text-slate-600 dark:text-slate-400 italic my-2">$1</blockquote>')
    .replace(/^---+$/gm, '<hr class="border-slate-200 dark:border-slate-700 my-3" />')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/^(?!<[h1-6]|<blockquote|<hr)(.+)$/gm, (match) => match.startsWith('<') ? match : match)
}

// ─── API ──────────────────────────────────────────────────────

async function fetchOutput(id: string): Promise<PipelineOutput | null> {
  const res = await fetch(`/api/brain/pipelines/${id}/output`)
  if (!res.ok) return null
  const data = await res.json()
  return data.output || null
}

async function fetchStages(id: string): Promise<Record<string, StageInfo>> {
  const res = await fetch(`/api/brain/pipelines/${id}/stages`)
  if (!res.ok) return {}
  const data = await res.json()
  return data.stages || {}
}

// ─── 子组件 ──────────────────────────────────────────────────

function StageStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />
  if (status === 'failed') return <AlertCircle className="w-4 h-4 text-red-400" />
  if (status === 'in_progress') return <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />
  return <div className="w-4 h-4 rounded-full border-2 border-slate-200 dark:border-slate-600" />
}

function StageBadge({ status }: { status: string }) {
  const clsMap: Record<string, string> = {
    completed: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',
    failed: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    in_progress: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  }
  const labelMap: Record<string, string> = {
    completed: '完成',
    failed: '失败',
    in_progress: '进行中',
    queued: '待执行',
  }
  const cls = clsMap[status] || 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${cls}`}>
      {labelMap[status] || '待执行'}
    </span>
  )
}

function StagesPanel({ stages }: { stages: Record<string, StageInfo> }) {
  return (
    <div className="space-y-0.5">
      {PIPELINE_STAGES.map(key => {
        const stage = stages[key]
        const status = stage?.status || 'pending'
        const duration = stage ? formatDuration(stage.started_at, stage.completed_at) : '—'
        const issues = stage?.review_issues as string[] | undefined

        return (
          <div key={key} className="flex items-start gap-3 py-2.5 border-b border-slate-50 dark:border-slate-800 last:border-0">
            <div className="mt-0.5 flex-shrink-0">
              <StageStatusIcon status={status} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {STAGE_LABELS[key]}
                </span>
                {duration !== '—' && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />{duration}
                  </span>
                )}
              </div>
              {issues && issues.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {(issues as string[]).map((issue, i) => (
                    <li key={i} className="text-xs text-red-500 dark:text-red-400">• {issue}</li>
                  ))}
                </ul>
              )}
            </div>
            <StageBadge status={status} />
          </div>
        )
      })}
    </div>
  )
}

function ExportPathPanel({ keyword, exportPath }: { keyword?: string; exportPath?: string }) {
  const displayPath = exportPath || (keyword ? `~/perfect21/zenithjoy/content-output/*-${keyword}/` : null)
  if (!displayPath) return null

  return (
    <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
          <FolderOpen className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        </div>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">导出路径</h3>
      </div>
      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 break-all leading-relaxed">
        {displayPath}
      </p>
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <FileText className="w-3 h-3 flex-shrink-0" />
          <span>article/article.md</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <FileText className="w-3 h-3 flex-shrink-0" />
          <span>cards/copy.md</span>
        </div>
      </div>
    </div>
  )
}

// ─── 主页面 ──────────────────────────────────────────────────

export default function PipelineOutputPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [output, setOutput] = useState<PipelineOutput | null>(null)
  const [stages, setStages] = useState<Record<string, StageInfo>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'article' | 'cards' | 'images'>('article')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([fetchOutput(id), fetchStages(id)]).then(([out, stg]) => {
      setOutput(out)
      setStages(stg)
      // 自动定位到有内容的 tab
      if (!out?.article_text && out?.image_urls?.length) setActiveTab('images')
      else if (!out?.article_text && out?.cards_text) setActiveTab('cards')
    }).finally(() => setLoading(false))
  }, [id])

  const coverImage = output?.image_urls?.find(u => u.type === 'cover')
  const cardImages = output?.image_urls?.filter(u => u.type === 'card') || []
  const allImages = output?.image_urls || []

  const statusConfig: Record<string, { label: string; cls: string }> = {
    completed: { label: '已完成', cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' },
    failed: { label: '失败', cls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' },
  }
  const statusInfo = output?.status
    ? (statusConfig[output.status] || { label: output.status, cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' })
    : null

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* 顶部导航 */}
      <div className="bg-white dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/content-factory')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回内容工厂
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
            {output?.keyword || '内容产出'}
          </h1>
          {statusInfo && (
            <span className={`ml-auto text-xs px-2.5 py-0.5 rounded-full font-medium ${statusInfo.cls}`}>
              {statusInfo.label}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-5 h-5 animate-spin text-violet-500 mr-2" />
          <span className="text-slate-500 dark:text-slate-400 text-sm">加载产出内容...</span>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="grid grid-cols-[1fr_280px] gap-6">
            {/* 左侧主内容 */}
            <div className="space-y-4">
              {/* Hero 封面图 */}
              {coverImage && (
                <div
                  className="hero relative rounded-xl overflow-hidden bg-slate-900 cursor-pointer group shadow-sm"
                  onClick={() => setSelectedImage(coverImage.url)}
                  style={{ maxHeight: '320px' }}
                >
                  <img
                    src={coverImage.url}
                    alt="封面"
                    className="w-full object-contain max-h-80 group-hover:opacity-90 transition-opacity"
                  />
                  <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/40 to-transparent flex items-end px-4 pb-3">
                    <span className="text-xs text-white/80 flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> 封面图 · 点击查看大图
                    </span>
                  </div>
                </div>
              )}

              {/* Tab 切换 */}
              <div className="flex gap-1 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-1 shadow-sm">
                {[
                  { key: 'article', label: '文章', icon: BookOpen, disabled: !output?.article_text },
                  { key: 'cards', label: '卡片文案', icon: FileText, disabled: !output?.cards_text },
                  { key: 'images', label: `图片 (${allImages.length})`, icon: ImageIcon, disabled: allImages.length === 0 },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => !tab.disabled && setActiveTab(tab.key as typeof activeTab)}
                    disabled={tab.disabled}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                      activeTab === tab.key
                        ? 'bg-violet-600 dark:bg-violet-500 text-white shadow-sm'
                        : tab.disabled
                        ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 文章内容 */}
              {activeTab === 'article' && (
                <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6">
                  {output?.article_text ? (
                    <div
                      className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300 leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: `<p class="mb-3">${renderMarkdown(output.article_text)}</p>`
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
                      <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无文章内容</p>
                      <p className="text-xs mt-1">Pipeline 完成后文章将显示在这里</p>
                    </div>
                  )}
                </div>
              )}

              {/* 卡片文案 */}
              {activeTab === 'cards' && (
                <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6">
                  {output?.cards_text ? (
                    <div
                      className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: `<p class="mb-3">${renderMarkdown(output.cards_text)}</p>`
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
                      <FileText className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无卡片文案</p>
                    </div>
                  )}
                </div>
              )}

              {/* 图片 */}
              {activeTab === 'images' && (
                <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-6">
                  {allImages.length > 0 ? (
                    <div>
                      {coverImage && (
                        <div className="mb-4">
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">封面</p>
                          <img
                            src={coverImage.url}
                            alt="封面"
                            className="rounded-xl max-h-80 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setSelectedImage(coverImage.url)}
                          />
                        </div>
                      )}
                      {cardImages.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">内容卡片（{cardImages.length} 张）</p>
                          <div className="grid grid-cols-3 gap-3">
                            {cardImages.map((img, i) => (
                              <img
                                key={i}
                                src={img.url}
                                alt={`卡片 ${img.index}`}
                                className="rounded-lg w-full aspect-[9/16] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setSelectedImage(img.url)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
                      <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无图片</p>
                      <p className="text-xs mt-1">图片生成阶段完成后将显示在这里</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 右侧面板 */}
            <div className="space-y-4">
              {/* 执行阶段 */}
              <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <Layers className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">执行阶段</h2>
                </div>
                <StagesPanel stages={stages} />
              </div>

              {/* 发布状态（如有 content_publish 阶段） */}
              {stages['content_publish'] && (
                <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/50 shadow-sm p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                      <Send className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />
                    </div>
                    <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">发布状态</h2>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-600 dark:text-slate-400">内容发布</span>
                    <StageBadge status={stages['content_publish'].status} />
                  </div>
                </div>
              )}

              {/* 导出路径 */}
              <ExportPathPanel keyword={output?.keyword} exportPath={output?.export_path} />
            </div>
          </div>
        </div>
      )}

      {/* 图片全屏预览 */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 dark:bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt="预览"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl font-light w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 transition-colors"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
