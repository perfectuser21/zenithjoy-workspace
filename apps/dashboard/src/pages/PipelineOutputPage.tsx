import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Clock, Image as ImageIcon, FileText, BookOpen, Layers, Send, BarChart2, Radio, Maximize2, Minimize2, ChevronLeft, ChevronRight, X } from 'lucide-react'

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
}

interface LightboxState {
  index: number
  urls: string[]
}

type TabKey = 'summary' | 'generation' | 'publish' | 'analytics'

// ─── 常量 ─────────────────────────────────────────────────────

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

const PLATFORMS = [
  { key: 'douyin',      name: '抖音',       color: '#fe2c55', metric: '播放' },
  { key: 'xiaohongshu', name: '小红书',     color: '#ff2442', metric: '曝光' },
  { key: 'wechat',      name: '微信公众号', color: '#07c160', metric: '阅读' },
  { key: 'shipinhao',   name: '视频号',     color: '#1aad19', metric: '播放' },
  { key: 'toutiao',     name: '今日头条',   color: '#e53935', metric: '阅读' },
  { key: 'weibo',       name: '微博',       color: '#e6162d', metric: '转发' },
  { key: 'kuaishou',    name: '快手',       color: '#ffd000', metric: '播放' },
  { key: 'zhihu',       name: '知乎',       color: '#1772f6', metric: '浏览' },
]

// ─── 工具函数 ─────────────────────────────────────────────────

function formatDuration(start?: string, end?: string): string {
  if (!start) return '—'
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  if (ms < 1000) return '< 1s'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
}

function renderMarkdown(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;margin:14px 0 4px;color:rgba(255,255,255,0.8)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:15px;font-weight:700;margin:18px 0 6px;color:rgba(255,255,255,0.9)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:17px;font-weight:800;margin:20px 0 8px;color:#fff">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(255,255,255,0.85)">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #7c3aed;padding-left:12px;color:rgba(255,255,255,0.4);font-style:italic;margin:8px 0">$1</blockquote>')
    .replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.07);margin:12px 0" />')
    .replace(/\n\n/g, '</p><p style="margin-bottom:10px">')
}

// ─── API ──────────────────────────────────────────────────────

const IMG_PROXY = '/content-images/'
const IMG_ORIGIN = 'http://38.23.47.81:9998/images/'

function rewriteImageUrl(url: string): string {
  return url.startsWith(IMG_ORIGIN) ? url.replace(IMG_ORIGIN, IMG_PROXY) : url
}

async function fetchOutput(id: string): Promise<PipelineOutput | null> {
  const res = await fetch(`/api/brain/pipelines/${id}/output`)
  if (!res.ok) return null
  const data: PipelineOutput | null = (await res.json()).output || null
  if (data?.image_urls) {
    data.image_urls = data.image_urls.map(img => ({ ...img, url: rewriteImageUrl(img.url) }))
  }
  return data
}

async function fetchStages(id: string): Promise<Record<string, StageInfo>> {
  const res = await fetch(`/api/brain/pipelines/${id}/stages`)
  if (!res.ok) return {}
  return (await res.json()).stages || {}
}

// ─── 原子组件 ─────────────────────────────────────────────────

function StageDot({ status }: { status: string }) {
  const base: React.CSSProperties = { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }
  if (status === 'completed') return <div style={{ ...base, background: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,0.5)' }} />
  if (status === 'failed') return <div style={{ ...base, background: '#f87171' }} />
  if (status === 'in_progress') return <div style={{ ...base, background: '#a78bfa', boxShadow: '0 0 6px rgba(167,139,250,0.5)', animation: 'pulse 1.5s ease-in-out infinite' }} />
  return <div style={{ ...base, background: 'rgba(255,255,255,0.12)' }} />
}

function StageBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    completed: ['完成', '#4ade80'],
    failed: ['失败', '#f87171'],
    in_progress: ['进行中', '#a78bfa'],
  }
  const [label, color] = map[status] || ['待执行', 'rgba(255,255,255,0.25)']
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, background: `${color}18`, color }}>{label}</span>
}

type PubStatus = 'live' | 'scheduled' | 'pending' | 'failed'
function PubBadge({ status }: { status: PubStatus }) {
  const map: Record<PubStatus, [string, string]> = {
    live: ['已发布', '#4ade80'],
    scheduled: ['定时发布', '#fbbf24'],
    pending: ['未发布', 'rgba(255,255,255,0.25)'],
    failed: ['发布失败', '#f87171'],
  }
  const [label, color] = map[status]
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: `${color}18`, color, border: `1px solid ${color}30` }}>{label}</span>
}

// ─── 全屏灯箱 ─────────────────────────────────────────────────

function Lightbox({ state, onClose }: { state: LightboxState; onClose: () => void }) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { index, urls } = state
  const [currentIndex, setCurrentIndex] = useState(index)

  const goNext = useCallback(() => setCurrentIndex(i => (i + 1) % urls.length), [urls.length])
  const goPrev = useCallback(() => setCurrentIndex(i => (i - 1 + urls.length) % urls.length), [urls.length])

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen()
      setIsFullscreen(true)
    } else {
      await document.exitFullscreen()
      setIsFullscreen(false)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Escape') { if (!document.fullscreenElement) onClose() }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goNext, goPrev, onClose, toggleFullscreen])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div
      ref={containerRef}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      {/* 顶部工具栏 */}
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)', zIndex: 1 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
          {currentIndex + 1} / {urls.length}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={toggleFullscreen} title={isFullscreen ? '退出全屏 (F)' : '全屏 (F)'} style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button onClick={onClose} title="关闭 (Esc)" style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 左右切换按钮 */}
      {urls.length > 1 && (
        <>
          <button
            onClick={e => { e.stopPropagation(); goPrev() }}
            style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, transition: 'background 0.15s' }}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); goNext() }}
            style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, transition: 'background 0.15s' }}
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {/* 图片 */}
      <img
        src={urls[currentIndex]}
        alt={`图片 ${currentIndex + 1}`}
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: isFullscreen ? 0 : 10, objectFit: 'contain', boxShadow: '0 32px 80px rgba(0,0,0,0.8)', transition: 'max-width 0.2s, max-height 0.2s' }}
      />

      {/* 底部缩略图条（多图时显示） */}
      {urls.length > 1 && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 16, display: 'flex', gap: 6, padding: '6px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: 10, backdropFilter: 'blur(8px)' }}>
          {urls.map((url, i) => (
            <div
              key={i}
              onClick={() => setCurrentIndex(i)}
              style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `2px solid ${i === currentIndex ? '#a78bfa' : 'transparent'}`, opacity: i === currentIndex ? 1 : 0.5, transition: 'all 0.15s', flexShrink: 0 }}
            >
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Summary Tab ──────────────────────────────────────────────

function SummaryTab({ output, stages }: { output: PipelineOutput | null; stages: Record<string, StageInfo> }) {
  const doneCount = PIPELINE_STAGES.filter(k => stages[k]?.status === 'completed').length
  const imgCount = output?.image_urls?.length || 0

  const cards = [
    { num: '—', label: '总曝光', sub: '发布后可见' },
    { num: '—', label: '总互动', sub: '点赞+评论+收藏' },
    { num: `${doneCount}/${PIPELINE_STAGES.length}`, label: '生成阶段', sub: '已完成' },
    { num: `${imgCount}`, label: '图片产出', sub: '张' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{c.num}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>{c.label}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const }}>平台发布概览</div>
        {PLATFORMS.map((p, i) => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: i < PLATFORMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, boxShadow: `0 0 6px ${p.color}80`, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', flex: 1 }}>{p.name}</span>
            <PubBadge status="pending" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Generation Tab ───────────────────────────────────────────

function GenerationTab({ output, stages, isTimingReliable, onImageOpen }: {
  output: PipelineOutput | null
  stages: Record<string, StageInfo>
  isTimingReliable: boolean
  onImageOpen: (index: number, urls: string[]) => void
}) {
  const [textTab, setTextTab] = useState<'article' | 'cards'>('article')
  const coverImage = output?.image_urls?.find(u => u.type === 'cover')
  const cardImages = output?.image_urls?.filter(u => u.type === 'card') || []
  const hasImages = (output?.image_urls?.length || 0) > 0
  const allUrls = output?.image_urls?.map(u => u.url) || []

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(220px,260px)', gap: 24, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        {/* 图片区 */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const }}>内容图片</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>{output?.image_urls?.length || 0} 张</span>
          </div>
          <div style={{ padding: 18 }}>
            {hasImages ? (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {coverImage && (
                  <div
                    onClick={() => onImageOpen(allUrls.indexOf(coverImage.url), allUrls)}
                    style={{ flexShrink: 0, width: 160, borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', cursor: 'zoom-in' }}
                  >
                    <img src={coverImage.url} alt="封面" style={{ width: '100%', display: 'block' }} />
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '5px 0', background: 'rgba(0,0,0,0.3)' }}>封面</div>
                  </div>
                )}
                <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8 }}>
                  {cardImages.map((img, i) => (
                    <div key={i}>
                      <div
                        onClick={() => onImageOpen(allUrls.indexOf(img.url), allUrls)}
                        style={{ borderRadius: 8, overflow: 'hidden', cursor: 'zoom-in', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
                      >
                        <img src={img.url} alt={`卡片${i + 1}`} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 4 }}>{String(i + 1).padStart(2, '0')}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.2)' }}>
                <ImageIcon size={28} style={{ marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>暂无图片</div>
                <div style={{ fontSize: 11, marginTop: 4, color: 'rgba(255,255,255,0.12)' }}>图片生成完成后将在此显示</div>
              </div>
            )}
          </div>
        </div>

        {/* 文本内容 */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '4px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 4 }}>
            {(['article', 'cards'] as const).map(t => (
              <button key={t} onClick={() => setTextTab(t)} style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: textTab === t ? 600 : 400, transition: 'all 0.15s', background: textTab === t ? 'rgba(124,58,237,0.2)' : 'transparent', color: textTab === t ? '#c084fc' : 'rgba(255,255,255,0.3)', borderBottom: `2px solid ${textTab === t ? '#a78bfa' : 'transparent'}` }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  {t === 'article' ? <><BookOpen size={12} />文章</> : <><FileText size={12} />卡片文案</>}
                </span>
              </button>
            ))}
          </div>
          <div style={{ padding: 20, maxHeight: 600, overflowY: 'auto' }}>
            {textTab === 'article' ? (
              output?.article_text ? (
                <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(255,255,255,0.5)' }} dangerouslySetInnerHTML={{ __html: `<p style="margin-bottom:10px">${renderMarkdown(output.article_text)}</p>` }} />
              ) : <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>暂无文章内容</div>
            ) : (
              output?.cards_text ? (
                <div style={{ fontSize: 13, lineHeight: 1.8, color: 'rgba(255,255,255,0.5)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: `<p style="margin-bottom:10px">${renderMarkdown(output.cards_text)}</p>` }} />
              ) : <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>暂无卡片文案</div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧：阶段 + 路径 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const }}>生成阶段</div>
          {PIPELINE_STAGES.map(key => {
            const s = stages[key]
            const status = s?.status || 'pending'
            const dur = isTimingReliable && s ? formatDuration(s.started_at, s.completed_at) : null
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <StageDot status={status} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', flex: 1 }}>{STAGE_LABELS[key]}</span>
                {dur && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={9} />{dur}</span>}
                <StageBadge status={status} />
              </div>
            )
          })}
        </div>

        {output?.keyword && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const, marginBottom: 10 }}>导出路径</div>
            <div style={{ fontFamily: 'SF Mono,Menlo,monospace', fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.8 }}>
              <span style={{ color: '#a78bfa' }}>content-output/</span><br />
              *-{output.keyword}/
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Publish Tab ──────────────────────────────────────────────

function PublishTab() {
  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const }}>平台发布记录</span>
        <button style={{ fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.15)', color: '#c084fc', cursor: 'pointer' }}>
          + 发布到平台
        </button>
      </div>
      {PLATFORMS.map((p, i) => (
        <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: i < PLATFORMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, boxShadow: `0 0 6px ${p.color}80`, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', width: 80, flexShrink: 0 }}>{p.name}</span>
          <PubBadge status="pending" />
          <div style={{ marginLeft: 'auto' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)' }}>—</div>
          </div>
        </div>
      ))}
      <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center' as const }}>
        发布后数据将自动同步到「数据记录」
      </div>
    </div>
  )
}

// ─── Analytics Tab ────────────────────────────────────────────

function AnalyticsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 3, textTransform: 'uppercase' as const }}>平台数据</div>
        {PLATFORMS.map((p, i) => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: i < PLATFORMS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, boxShadow: `0 0 6px ${p.color}80`, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', width: 80 }}>{p.name}</span>
            <PubBadge status="pending" />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 24 }}>
              {['曝光', '互动', '转化'].map(label => (
                <div key={label} style={{ textAlign: 'right' as const }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.2)' }}>—</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', marginTop: 1 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: 'rgba(124,58,237,0.05)', border: '1px dashed rgba(124,58,237,0.2)', borderRadius: 12, padding: '20px', textAlign: 'center' as const }}>
        <BarChart2 size={22} style={{ color: 'rgba(167,139,250,0.4)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>数据接入开发中</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)', marginTop: 4 }}>发布完成后可手动录入，或等待各平台 API 自动同步</div>
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
  const [activeTab, setActiveTab] = useState<TabKey>('generation')
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([fetchOutput(id), fetchStages(id)]).then(([out, stg]) => {
      setOutput(out)
      setStages(stg)
    }).finally(() => setLoading(false))
  }, [id])

  const allTs = Object.values(stages)
    .flatMap(s => [s.started_at, s.completed_at])
    .filter(Boolean).map(t => new Date(t!).getTime())
  const isTimingReliable = allTs.length >= 2
    ? (Math.max(...allTs) - Math.min(...allTs)) >= 5000 : false

  const TABS: { key: TabKey; label: string; Icon: typeof Layers }[] = [
    { key: 'summary',    label: 'Summary',  Icon: Radio },
    { key: 'generation', label: '生成记录', Icon: Layers },
    { key: 'publish',    label: '发布记录', Icon: Send },
    { key: 'analytics',  label: '数据记录', Icon: BarChart2 },
  ]

  const handleImageOpen = useCallback((index: number, urls: string[]) => {
    setLightbox({ index, urls })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#07050f', color: '#fff', fontFamily: "-apple-system,'SF Pro Display','Helvetica Neue',Arial,sans-serif" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* 导航 */}
      <div style={{ padding: '14px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(7,5,15,0.9)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={() => navigate('/content-factory')} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <ArrowLeft size={14} /> 内容工厂
        </button>
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>作品主页</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: output?.status === 'completed' ? '#4ade80' : '#fbbf24', boxShadow: output?.status === 'completed' ? '0 0 6px rgba(74,222,128,0.5)' : 'none' }} />
          <span style={{ fontSize: 12, color: output?.status === 'completed' ? '#4ade80' : '#fbbf24' }}>
            {output?.status === 'completed' ? '已完成' : (output?.status || '加载中')}
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10, color: 'rgba(255,255,255,0.3)' }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 13 }}>加载中...</span>
        </div>
      ) : (
        <>
          {/* Hero */}
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 40px 36px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 40, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(192,132,252,0.5)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 12 }}>内容产出</div>
              <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, background: 'linear-gradient(135deg,#ffffff 0%,#c084fc 55%,#7c3aed 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {output?.keyword || '内容产出'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', gap: 5 }}><ImageIcon size={12} />{output?.image_urls?.length || 0} 张图片</span>
                {output?.article_text && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', gap: 5 }}><BookOpen size={12} />文章</span>}
                {output?.cards_text && <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', gap: 5 }}><FileText size={12} />卡片文案</span>}
              </div>
            </div>
            {(() => {
              const cover = output?.image_urls?.find(u => u.type === 'cover')
              return cover ? (
                <div
                  onClick={() => handleImageOpen(output!.image_urls.indexOf(cover), output!.image_urls.map(u => u.url))}
                  style={{ flexShrink: 0, width: 120, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', cursor: 'zoom-in', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <img src={cover.url} alt="封面" style={{ width: '100%', display: 'block' }} />
                </div>
              ) : null
            })()}
          </div>

          {/* Tabs + 内容 */}
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 40px' }}>
            <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: 28 }}>
              {TABS.map(({ key, label, Icon }) => {
                const active = activeTab === key
                return (
                  <button key={key} onClick={() => setActiveTab(key)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 20px', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#c084fc' : 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: `2px solid ${active ? '#a78bfa' : 'transparent'}`, marginBottom: -1, transition: 'all 0.15s' }}>
                    <Icon size={14} />{label}
                  </button>
                )
              })}
            </div>

            {activeTab === 'summary'    && <SummaryTab output={output} stages={stages} />}
            {activeTab === 'generation' && <GenerationTab output={output} stages={stages} isTimingReliable={isTimingReliable} onImageOpen={handleImageOpen} />}
            {activeTab === 'publish'    && <PublishTab />}
            {activeTab === 'analytics'  && <AnalyticsTab />}

            <div style={{ height: 60 }} />
          </div>
        </>
      )}

      {/* 全屏灯箱 */}
      {lightbox && <Lightbox state={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}
