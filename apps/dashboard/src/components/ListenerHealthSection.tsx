/**
 * ListenerHealthSection — 微信客服监听健康看板（共享组件）
 *
 * 原内联在 WechatCustomerServiceConfigPage，整合后抽出供「我的客服机」(CsOneClickSetupPage)
 * 与「话术知识库」(WechatCustomerServiceConfigPage) 两处复用。
 * 每 15 秒自动刷新，按 3 分钟心跳判在线，展示每台监听客户端的微信窗口/会话/未读/已回复诊断。
 */
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Activity } from 'lucide-react'
import { getListenerStatus, type ListenerStatus } from '../api/wechat-cs-config.api'

const ONLINE_THRESHOLD_MS = 3 * 60 * 1000 // 3 分钟内有心跳 = 在线
const LISTENER_REFRESH_MS = 15 * 1000 // 15 秒自动刷新一次

// "X 分钟前" 时间格式化（内联小工具）
function relativeTime(tsMs: number, now: number): string {
  const diff = Math.max(0, now - tsMs)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

// 微信窗口状态文案
function windowStatusText(diag: ListenerStatus['diag']): { text: string; ok: boolean } {
  if (diag?.main_window_found) return { text: '已登录', ok: true }
  if (diag?.login_present) return { text: '需扫码登录', ok: false }
  return { text: '未找到微信', ok: false }
}

function ListenerCard({ listener, now }: { listener: ListenerStatus; now: number }) {
  const online = now - listener.ts < ONLINE_THRESHOLD_MS
  const diag = listener.diag
  const win = windowStatusText(diag)
  const name = listener.wechat_id || listener.agent_id || '未知客户端'
  const unreadSenders = diag?.unread_senders ?? []

  return (
    <div
      data-testid="listener-card"
      className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm" aria-hidden>
            {online ? '🟢' : '🔴'}
          </span>
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate" title={name}>
            {name}
          </span>
          {listener.agent_id && listener.wechat_id && (
            <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
              ({listener.agent_id})
            </span>
          )}
        </div>
        <span
          className={`flex-shrink-0 text-xs font-medium ${
            online ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {online ? '在线' : `掉线 · ${relativeTime(listener.ts, now)}`}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-slate-400 dark:text-slate-500">微信窗口</div>
          <div
            className={`font-medium ${
              win.ok ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {win.text}
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-slate-500">看到会话</div>
          <div className="font-medium text-slate-700 dark:text-slate-200">
            {diag?.sessions_seen ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-slate-500">未读</div>
          <div className="font-medium text-slate-700 dark:text-slate-200">
            {diag?.unread_count ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-400 dark:text-slate-500">已回复</div>
          <div className="font-medium text-slate-700 dark:text-slate-200">
            {diag?.replied_count ?? '—'}
          </div>
        </div>
      </div>

      {unreadSenders.length > 0 && (
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          未读来自：{unreadSenders.join('、')}
        </div>
      )}

      {diag?.last_error && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span className="break-all">最后错误：{diag.last_error}</span>
        </div>
      )}
    </div>
  )
}

export default function ListenerHealthSection() {
  const [listeners, setListeners] = useState<ListenerStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await getListenerStatus()
        if (cancelled) return
        setListeners(data)
        setError(false)
      } catch {
        if (cancelled) return
        setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
      if (!cancelled) setNow(Date.now())
    }

    load()
    const timer = setInterval(load, LISTENER_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div
      data-testid="listener-health-section"
      className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 mb-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            微信客服监听健康
          </h3>
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">每 15 秒自动刷新</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertCircle className="w-4 h-4" />
          加载监听状态失败
        </div>
      ) : listeners.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
          暂无监听上报（客户端 Agent 未连或未启动）
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {listeners.map((l, i) => (
            <ListenerCard key={l.agent_id || l.wechat_id || i} listener={l} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
