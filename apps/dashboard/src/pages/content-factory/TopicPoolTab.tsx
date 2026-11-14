import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
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

import { PipelineApiError, registerPipeline, type PipelineRegistration } from '../../api/pipeline.api'
import { PacingBar, TopicForm, TopicRow } from './TopicPoolControls'

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
  const [registrations, setRegistrations] = useState<Record<string, {runId: string; status: 'unknown' | 'registered'; taskStatus?: PipelineRegistration['status']}>>({})
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
    const registration = registrations[t.id]
    if (registration?.status === 'registered') return
    if (!registration && !confirm(`立即把"${t.title}"推成 pipeline？`)) return
    setBusyId(t.id)
    try {
      const run = registration ? await registerPipeline(registration.runId) : await publishTopicNow(t)
      setRegistrations(previous => ({...previous, [t.id]:{runId:run.id, status:'registered',taskStatus:run.status}}))
      const messages = {pending:'已登记任务，等待 Worker 认领',running:'已有任务正在执行',completed:'已有任务已完成，请在生产看板查看产出',failed:'已有任务失败，请在生产看板重跑'}
      setFlash({ type: run.status === 'failed' ? 'err' : 'ok', msg: messages[run.status] })
      await loadAll()
    } catch (e) {
      const details = e instanceof PipelineApiError ? e.details : null
      const sameRun = !registration || registration.runId === details?.pipeline_run_id
      if (details?.registration_status === 'unknown' && details.pipeline_run_id && sameRun) {
        setRegistrations(previous => ({...previous, [t.id]:{runId:details.pipeline_run_id!,status:'unknown'}}))
        setFlash({type:'err',msg:`${e instanceof Error ? e.message : '登记结果未知'}；请重试同一任务挂号`})
      } else if (details?.registration_status === 'rejected' && sameRun) {
        setRegistrations(previous => { const next = {...previous}; delete next[t.id]; return next })
        setFlash({type:'err',msg:`登记已拒绝：${e instanceof Error ? e.message : '任务未获准'}`})
      } else setFlash({ type: 'err', msg: e instanceof Error ? e.message : '派发失败' })
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
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notebook</th>
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
                  registrationStatus={registrations[t.id]?.status}
                  registeredTaskStatus={registrations[t.id]?.taskStatus}
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
