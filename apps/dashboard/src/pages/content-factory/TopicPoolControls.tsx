import { useEffect, useState } from 'react'
import { Loader2, Trash2, Edit3, Send, AlertCircle, X, Save } from 'lucide-react'
import { TOPIC_STATUSES, type Topic, type TopicStatus, type CreateTopicInput } from '../../api/topics.api'

const STATUS_STYLE: Record<TopicStatus, string> = {
  待研究: 'bg-gray-100 text-gray-700 border-gray-200',
  已通过: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  研究中: 'bg-blue-100 text-blue-700 border-blue-200',
  已发布: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  已拒绝: 'bg-red-100 text-red-700 border-red-200',
}

const DEFAULT_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'kuaishou',
  'shipinhao',
  'x',
  'toutiao',
  'weibo',
  'wechat',
]

// ─── 节奏配置条 ───────────────────────────────────────────────────

interface PacingBarProps {
  dailyLimit: number
  publishedToday: number
  onChange: (newLimit: number) => void
  loading: boolean
}

export function PacingBar({ dailyLimit, publishedToday, onChange, loading }: PacingBarProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(dailyLimit)

  useEffect(() => {
    setDraft(dailyLimit)
  }, [dailyLimit])

  const handleSave = () => {
    if (draft < 0 || draft > 100) return
    onChange(draft)
    setEditing(false)
  }

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-sm p-4 mb-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div>
          <div className="text-xs text-gray-500 mb-0.5">今日已发</div>
          <div className="text-xl font-semibold text-indigo-700">{publishedToday}</div>
        </div>
        <div className="w-px h-10 bg-gray-100" />
        <div>
          <div className="text-xs text-gray-500 mb-0.5">每日节奏</div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={draft}
                onChange={(e) => setDraft(Number(e.target.value))}
                className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-sm"
                aria-label="daily_limit"
              />
              <button
                onClick={handleSave}
                disabled={loading}
                className="p-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                aria-label="保存节奏"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setDraft(dailyLimit)
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
                aria-label="取消"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-xl font-semibold text-gray-800 hover:text-indigo-700"
              aria-label={`每日节奏：${dailyLimit}（点击编辑）`}
            >
              {dailyLimit}
              <span className="ml-1 text-xs text-gray-400">条/天</span>
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-gray-400">
        选题池 v1 · 超过 daily_limit 的选题会留到次日
      </div>
    </div>
  )
}

// ─── 编辑表单 ─────────────────────────────────────────────────────

interface TopicFormProps {
  initial?: Partial<Topic>
  onSubmit: (input: CreateTopicInput) => Promise<void>
  onCancel: () => void
  submitting: boolean
}

export function TopicForm({ initial, onSubmit, onCancel, submitting }: TopicFormProps) {
  const [title, setTitle] = useState(initial?.title || '')
  const [angle, setAngle] = useState(initial?.angle || '')
  const [priority, setPriority] = useState(initial?.priority ?? 100)
  const [status, setStatus] = useState<TopicStatus>(
    (initial?.status as TopicStatus) || '待研究'
  )
  const [platforms, setPlatforms] = useState<string[]>(
    initial?.target_platforms && initial.target_platforms.length > 0
      ? initial.target_platforms
      : DEFAULT_PLATFORMS
  )
  const [scheduledDate, setScheduledDate] = useState(
    initial?.scheduled_date || ''
  )
  const [notebookId, setNotebookId] = useState(initial?.notebook_id || '')
  const [err, setErr] = useState('')

  const handleSubmit = async () => {
    if (!title.trim()) {
      setErr('标题不能为空')
      return
    }
    if (!Number.isFinite(priority) || priority < 0 || priority > 9999) {
      setErr('优先级必须是 0–9999 的数字')
      return
    }
    if (!TOPIC_STATUSES.includes(status)) {
      setErr('非法状态')
      return
    }
    if (platforms.length === 0) {
      setErr('至少选择 1 个目标平台')
      return
    }
    const nbTrim = notebookId.trim()
    if (nbTrim && nbTrim.length > 100) {
      setErr('NotebookLM ID 长度不能超过 100')
      return
    }
    setErr('')
    try {
      await onSubmit({
        title: title.trim(),
        angle: angle.trim() || undefined,
        priority,
        status,
        target_platforms: platforms,
        scheduled_date: scheduledDate || null,
        notebook_id: nbTrim || null,
      })
    } catch (e) {
      // 外层已有 flash 提示，这里补一层本地错误避免吞异常
      setErr(e instanceof Error ? e.message : '提交失败')
    }
  }

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )
  }

  return (
    <div className="bg-white rounded-xl border border-indigo-200 shadow-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-800">
          {initial?.id ? '编辑选题' : '新增选题'}
        </h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" aria-label="关闭">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：AI 时代的一人公司"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            切入角度 <span className="text-gray-400 font-normal">(可选)</span>
          </label>
          <input
            type="text"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            placeholder="如：从成本结构看"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            优先级（越小越优先）
          </label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">状态</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TopicStatus)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          >
            {TOPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            计划日期 <span className="text-gray-400 font-normal">(可选)</span>
          </label>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            NotebookLM ID <span className="text-gray-400 font-normal">(可选)</span>
          </label>
          <input
            type="text"
            value={notebookId}
            onChange={(e) => setNotebookId(e.target.value)}
            placeholder="留空使用默认 notebook（env CREATOR_DEFAULT_NOTEBOOK_ID）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:border-indigo-400"
            aria-label="NotebookLM ID"
          />
          <p className="text-xs text-gray-400 mt-1">
            research 阶段调研用。手填 UUID，留空则 fallback 到全局默认。
          </p>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-2">目标平台</label>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_PLATFORMS.map((p) => {
              const selected = platforms.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    selected
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {err && (
        <div className="mt-3 flex items-center gap-1.5 text-sm text-red-600">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {err}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          保存
        </button>
      </div>
    </div>
  )
}

// ─── 单条选题行 ───────────────────────────────────────────────────

interface TopicRowProps {
  topic: Topic
  onEdit: (t: Topic) => void
  onDelete: (t: Topic) => void
  onStatusChange: (t: Topic, status: TopicStatus) => void
  onPublishNow: (t: Topic) => void
  registrationStatus?: 'unknown' | 'registered'
  registeredTaskStatus?: 'pending' | 'running' | 'completed' | 'failed'
  busy: boolean
}

export function TopicRow({
  topic,
  onEdit,
  onDelete,
  onStatusChange,
  onPublishNow,
  registrationStatus,
  registeredTaskStatus,
  busy,
}: TopicRowProps) {
  const registrationLabel = registrationStatus === 'unknown' ? '重试挂号' : registrationStatus === 'registered' ? ({pending:'已登记待认领',running:'已有任务执行中',completed:'已有任务已完成',failed:'已有失败任务'}[registeredTaskStatus || 'pending']) : '立即发布'
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="px-3 py-2 text-sm text-gray-500 w-16">{topic.priority}</td>
      <td className="px-3 py-2">
        <div className="font-medium text-sm text-gray-800">{topic.title}</div>
        {topic.angle && (
          <div className="text-xs text-gray-500 mt-0.5">切入角度：{topic.angle}</div>
        )}
      </td>
      <td className="px-3 py-2 w-28">
        <select
          value={topic.status}
          onChange={(e) => onStatusChange(topic, e.target.value as TopicStatus)}
          disabled={busy}
          className={`text-xs px-2 py-1 rounded border ${
            STATUS_STYLE[topic.status]
          } focus:outline-none`}
          aria-label={`状态：${topic.status}`}
        >
          {TOPIC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 w-28">
        {topic.scheduled_date || '—'}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {topic.target_platforms.slice(0, 3).join('/')}
        {topic.target_platforms.length > 3 && ` +${topic.target_platforms.length - 3}`}
      </td>
      <td
        className="px-3 py-2 text-xs text-gray-500 font-mono w-24"
        title={topic.notebook_id || '未配置（将 fallback 到默认 notebook）'}
      >
        {topic.notebook_id ? topic.notebook_id.slice(0, 8) : '—'}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={() => onPublishNow(topic)}
          disabled={busy || registrationStatus === 'registered'}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100 disabled:opacity-50"
          aria-label={registrationLabel}
        >
          <Send className="w-3 h-3" />
          {registrationLabel}
        </button>
        <button
          onClick={() => onEdit(topic)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 ml-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
          aria-label="编辑选题"
        >
          <Edit3 className="w-3 h-3" />
          编辑
        </button>
        <button
          onClick={() => onDelete(topic)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 ml-1 text-xs text-red-600 hover:bg-red-50 rounded"
          aria-label="删除选题"
        >
          <Trash2 className="w-3 h-3" />
          删除
        </button>
      </td>
    </tr>
  )
}

