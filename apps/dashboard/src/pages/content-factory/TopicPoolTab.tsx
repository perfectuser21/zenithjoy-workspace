import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Loader2,
  Trash2,
  Edit3,
  Send,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Save,
} from 'lucide-react'
import {
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  getPacingConfig,
  updatePacingConfig,
  publishTopicNow,
  TOPIC_STATUSES,
  type Topic,
  type TopicStatus,
  type CreateTopicInput,
} from '../../api/topics.api'

// ─── 样式常量 ─────────────────────────────────────────────────────

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

function PacingBar({ dailyLimit, publishedToday, onChange, loading }: PacingBarProps) {
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

function TopicForm({ initial, onSubmit, onCancel, submitting }: TopicFormProps) {
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
  const [err, setErr] = useState('')

  const handleSubmit = async () => {
    if (!title.trim()) {
      setErr('标题不能为空')
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
  busy: boolean
}

function TopicRow({
  topic,
  onEdit,
  onDelete,
  onStatusChange,
  onPublishNow,
  busy,
}: TopicRowProps) {
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
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={() => onPublishNow(topic)}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-700 bg-indigo-50 rounded hover:bg-indigo-100 disabled:opacity-50"
          aria-label="立即发布"
        >
          <Send className="w-3 h-3" />
          立即发布
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

// ─── 主组件 ───────────────────────────────────────────────────────

export default function TopicPoolTab() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [pacing, setPacing] = useState<{ daily_limit: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Topic | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filterStatus, setFilterStatus] = useState<TopicStatus | ''>('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [listRes, pacingRes] = await Promise.all([
        listTopics({ status: filterStatus || undefined, limit: 200 }),
        getPacingConfig(),
      ])
      setTopics(listRes.items)
      setPacing(pacingRes)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const publishedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return topics.filter(
      (t) => (t.published_at || '').startsWith(today) || t.status === '已发布'
    ).length
  }, [topics])

  const handleCreate = async (input: CreateTopicInput) => {
    setSubmitting(true)
    try {
      await createTopic(input)
      setShowForm(false)
      setFlash({ type: 'ok', msg: '选题已创建' })
      await loadAll()
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '创建失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdate = async (input: CreateTopicInput) => {
    if (!editing) return
    setSubmitting(true)
    try {
      await updateTopic(editing.id, input)
      setEditing(null)
      setFlash({ type: 'ok', msg: '选题已更新' })
      await loadAll()
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '更新失败' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (t: Topic) => {
    if (!confirm(`确认删除选题：${t.title}？`)) return
    setBusyId(t.id)
    try {
      await deleteTopic(t.id)
      setFlash({ type: 'ok', msg: '已删除' })
      await loadAll()
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '删除失败' })
    } finally {
      setBusyId(null)
    }
  }

  const handleStatusChange = async (t: Topic, status: TopicStatus) => {
    setBusyId(t.id)
    try {
      await updateTopic(t.id, { status })
      setFlash({ type: 'ok', msg: `已改为 ${status}` })
      await loadAll()
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '更新失败' })
    } finally {
      setBusyId(null)
    }
  }

  const handlePublishNow = async (t: Topic) => {
    if (!confirm(`立即把"${t.title}"推成 pipeline？`)) return
    setBusyId(t.id)
    try {
      await publishTopicNow(t)
      await updateTopic(t.id, { status: '研究中' })
      setFlash({ type: 'ok', msg: '已推送至 pipeline' })
      await loadAll()
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '派发失败' })
    } finally {
      setBusyId(null)
    }
  }

  const handlePacingChange = async (newLimit: number) => {
    try {
      const res = await updatePacingConfig({ daily_limit: newLimit })
      setPacing(res)
      setFlash({ type: 'ok', msg: `节奏已更新为 ${newLimit} 条/天` })
    } catch (e) {
      setFlash({ type: 'err', msg: e instanceof Error ? e.message : '更新失败' })
    }
  }

  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 2600)
      return () => clearTimeout(t)
    }
  }, [flash])

  return (
    <div>
      {/* 节奏条 */}
      <PacingBar
        dailyLimit={pacing?.daily_limit ?? 1}
        publishedToday={publishedToday}
        onChange={handlePacingChange}
        loading={loading}
      />

      {/* 顶部操作 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setShowForm(true)
              setEditing(null)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            新增选题
          </button>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as TopicStatus | '')}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            aria-label="按状态筛选"
          >
            <option value="">全部状态</option>
            {TOPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="p-2 text-gray-400 hover:text-gray-600"
          aria-label="刷新"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* flash 提示 */}
      {flash && (
        <div
          className={`mb-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            flash.type === 'ok'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
          role="status"
        >
          {flash.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {flash.msg}
        </div>
      )}

      {/* 表单 */}
      {showForm && !editing && (
        <TopicForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          submitting={submitting}
        />
      )}
      {editing && (
        <TopicForm
          initial={editing}
          onSubmit={handleUpdate}
          onCancel={() => setEditing(null)}
          submitting={submitting}
        />
      )}

      {/* 列表 */}
      {error ? (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      ) : loading && topics.length === 0 ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : topics.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <p className="text-sm">选题池为空</p>
          <p className="text-xs mt-1">点击"新增选题"开始</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">优先级</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">标题</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">状态</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">计划</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">平台</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <TopicRow
                  key={t.id}
                  topic={t}
                  onEdit={(t) => {
                    setEditing(t)
                    setShowForm(false)
                  }}
                  onDelete={handleDelete}
                  onStatusChange={handleStatusChange}
                  onPublishNow={handlePublishNow}
                  busy={busyId === t.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
