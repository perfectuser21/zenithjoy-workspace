/**
 * CsWorkSummaryPage — 客服工作汇总（Line04 私域客服区）
 *
 * 管理员一眼看到「每台客服机今天/昨天干了多少活」：每客服一张卡，展示四数
 * （接收 / 回复 / 接待 / 工作时长）+ 客服名 + 在线状态 + 真发/演练标，顶部切今天/昨天。
 *
 * 数据源：GET /api/wechat/cs/stats?date=today|yesterday（后端按北京时区聚合，NULL 身份章不计入、
 * 按 cs_wechat_id 隔离不串台）。纯渲染逻辑，E2E 由 page.route 拦后端在 windows job 跑。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { MessageCircle, Inbox, Send, Users, Clock } from 'lucide-react'

type StatsDate = 'today' | 'yesterday'

interface CsCard {
  cs_wechat_id: string
  cs_name: string
  online: boolean
  mode: 'live' | 'dryrun'
  received_count: number
  reply_count: number
  served_customers: number
  work_duration_minutes: number
}

interface StatsResp {
  ok: boolean
  date: StatsDate
  timezone: string
  agents: CsCard[]
}

export default function CsWorkSummaryPage() {
  const [date, setDate] = useState<StatsDate>('today')
  const [agents, setAgents] = useState<CsCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: StatsDate) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wechat/cs/stats?date=${d}`)
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const data = (await res.json()) as StatsResp
      setAgents(Array.isArray(data.agents) ? data.agents : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(date)
  }, [date, load])

  const toggleCls = (active: boolean) =>
    `px-4 py-1.5 rounded-lg text-sm font-medium transition ${
      active
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
    }`

  return (
    <div className="max-w-5xl mx-auto" data-testid="cs-work-summary-page">
      <div className="flex items-center gap-2 mb-2">
        <MessageCircle className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">客服工作汇总</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        每台客服机今天/昨天处理了多少活（北京时区）。
      </p>

      {/* 今天 / 昨天切换 */}
      <div className="flex items-center gap-2 mb-6">
        <button
          data-testid="date-toggle-today"
          onClick={() => setDate('today')}
          className={toggleCls(date === 'today')}
        >
          今天
        </button>
        <button
          data-testid="date-toggle-yesterday"
          onClick={() => setDate('yesterday')}
          className={toggleCls(date === 'yesterday')}
        >
          昨天
        </button>
      </div>

      {loading && <div className="text-gray-500 dark:text-gray-400">加载中…</div>}
      {error && (
        <div data-testid="cs-stats-error" className="text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {!loading && !error && agents.length === 0 && (
        <div data-testid="cs-stats-empty" className="text-gray-500 dark:text-gray-400">
          还没有客服机的工作数据。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((a) => (
          <div
            key={a.cs_wechat_id}
            data-testid={`cs-card-${a.cs_wechat_id}`}
            className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${a.online ? 'bg-green-500' : 'bg-gray-300'}`}
                  data-testid="cs-online-dot"
                  title={a.online ? '在线' : '离线'}
                />
                <span className="font-semibold text-gray-900 dark:text-white" data-testid="cs-name">
                  {a.cs_name}
                </span>
              </div>
              <span
                data-testid="cs-mode-badge"
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  a.mode === 'live'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }`}
              >
                {a.mode === 'live' ? '真发' : '演练'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Metric icon={<Inbox className="w-4 h-4 text-blue-500" />} label="接收">
                <span data-testid="received-count">{a.received_count}</span>
              </Metric>
              <Metric icon={<Send className="w-4 h-4 text-indigo-500" />} label="回复">
                <span data-testid="reply-count">{a.reply_count}</span>
              </Metric>
              <Metric icon={<Users className="w-4 h-4 text-emerald-500" />} label="接待">
                <span data-testid="served-customers">{a.served_customers}</span>
              </Metric>
              <Metric icon={<Clock className="w-4 h-4 text-amber-500" />} label="工作时长">
                <span data-testid="work-duration">{a.work_duration_minutes} 分钟</span>
              </Metric>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
        <div className="text-lg font-bold text-gray-900 dark:text-white">{children}</div>
      </div>
    </div>
  )
}
