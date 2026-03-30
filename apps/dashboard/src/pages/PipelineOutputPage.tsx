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
] as const

const STAGE_LABELS: Record<string, string> = {
  'content-research': '调研',
  'content-copywriting': '文案生成',
  'content-copy-review': '文案审核',
  'content-generate': '图片生成',
  'content-image-review': '图片审核',
  'content-export': '导出',
}

function formatDuration(start?: string, end?: string) {
  if (!start) return null
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const secs = Math.round((e - s) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m${secs % 60}s`
}

// 简单的 markdown 渲染（加粗、斜体、标题、段落）
function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-gray-800 mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-gray-900 mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 mt-6 mb-3">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-indigo-300 pl-4 text-gray-600 italic my-2">$1</blockquote>')
    .replace(/^---+$/gm, '<hr class="border-gray-200 my-3" />')
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

function StagesPanel({ stages }: { stages: Record<string, StageInfo> }) {
  return (
    <div className="space-y-2">
      {PIPELINE_STAGES.map(key => {
        const stage = stages[key]
        const status = stage?.status || 'pending'
        const duration = stage ? formatDuration(stage.started_at, stage.completed_at) : null
        const issues = stage?.review_issues as string[] | undefined

        return (
          <div key={key} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
            <div className="mt-0.5">
              {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
              {status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
              {status === 'in_progress' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
              {(status === 'pending' || !status) && <div className="w-4 h-4 rounded-full border-2 border-gray-200" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">{STAGE_LABELS[key]}</span>
                {duration && (
                  <span className="text-xs text-gray-400 flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />{duration}
                  </span>
                )}
              </div>
              {issues && issues.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {(issues as string[]).map((issue, i) => (
                    <li key={i} className="text-xs text-red-600">• {issue}</li>
                  ))}
                </ul>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
              status === 'completed' ? 'bg-green-100 text-green-700' :
              status === 'failed' ? 'bg-red-100 text-red-700' :
              status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
              'bg-gray-100 text-gray-500'
            }`}>
              {status === 'completed' ? '完成' : status === 'failed' ? '失败' : status === 'in_progress' ? '进行中' : '待执行'}
            </span>
          </div>
        )
      })}
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate('/content-factory')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回内容工厂
          </button>
          <div className="h-4 w-px bg-gray-200" />
          <h1 className="text-sm font-semibold text-gray-800 truncate">
            {output?.keyword || '内容产出'}
          </h1>
          {output?.status && (
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
              output.status === 'completed' ? 'bg-green-100 text-green-700' :
              output.status === 'failed' ? 'bg-red-100 text-red-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {output.status === 'completed' ? '已完成' : output.status === 'failed' ? '失败' : output.status}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mr-2" />
          <span className="text-gray-500">加载产出内容...</span>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="grid grid-cols-[1fr_280px] gap-6">
            {/* 左侧主内容 */}
            <div className="space-y-4">
              {/* Tab 切换 */}
              <div className="flex gap-1 bg-white rounded-xl border border-gray-100 p-1 shadow-sm">
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
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : tab.disabled
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 文章内容 */}
              {activeTab === 'article' && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                  {output?.article_text ? (
                    <div
                      className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                      dangerouslySetInnerHTML={{
                        __html: `<p class="mb-3">${renderMarkdown(output.article_text)}</p>`
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <BookOpen className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无文章内容</p>
                      <p className="text-xs mt-1">Pipeline 完成后文章将显示在这里</p>
                    </div>
                  )}
                </div>
              )}

              {/* 卡片文案 */}
              {activeTab === 'cards' && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                  {output?.cards_text ? (
                    <div
                      className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: `<p class="mb-3">${renderMarkdown(output.cards_text)}</p>`
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <FileText className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无卡片文案</p>
                    </div>
                  )}
                </div>
              )}

              {/* 图片 */}
              {activeTab === 'images' && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                  {allImages.length > 0 ? (
                    <div>
                      {coverImage && (
                        <div className="mb-4">
                          <p className="text-xs font-medium text-gray-500 mb-2">封面</p>
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
                          <p className="text-xs font-medium text-gray-500 mb-2">内容卡片（{cardImages.length} 张）</p>
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
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
                      <p className="text-sm">暂无图片</p>
                      <p className="text-xs mt-1">图片生成阶段完成后将显示在这里</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 右侧阶段状态 */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-gray-500" />
                  <h2 className="text-sm font-semibold text-gray-700">执行阶段</h2>
                </div>
                <StagesPanel stages={stages} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 图片全屏预览 */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt="预览"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl font-light"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
