/**
 * Line04PreflightCard — 本机环境状态卡片（微信客服配置页顶部）
 *
 * 调用 fetchModuleHealth() 获取最近活跃机器的 line04-wechat-cs 预检状态，
 * 显示各项 ✅/❌ 及失败原因，无数据时提示"Agent 未连接"。
 */
import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertCircle, MonitorCheck } from 'lucide-react'
import { fetchModuleHealth, type AgentModuleHealth } from '../api/moduleHealth.api'

const MODULE_KEY = 'line04-wechat-cs'

export default function Line04PreflightCard() {
  const [machine, setMachine] = useState<AgentModuleHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetchModuleHealth()
        if (cancelled) return
        if (res.ok && res.data.length > 0) {
          // 展示最近活跃的一台机器（按 updated_at 降序取第一台）
          const sorted = [...res.data].sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )
          setMachine(sorted[0])
        } else {
          setMachine(null)
        }
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const status = machine?.module_status?.[MODULE_KEY]
  const ok = status?.ok
  const reason = status?.reason

  return (
    <div
      data-testid="line04-preflight-card"
      className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 mb-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <MonitorCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">本机环境状态</h3>
        {machine && (
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-auto">
            {machine.hostname}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          <AlertCircle className="w-4 h-4" />
          加载环境状态失败
        </div>
      ) : machine === null || status === undefined ? (
        <div className="py-3 text-sm text-slate-400 dark:text-slate-500">
          Agent 未连接或尚未上报环境状态
        </div>
      ) : ok ? (
        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>Line04 环境检测全部通过</span>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Line04 环境检测未通过</span>
          </div>
          {reason && (
            <div className="ml-6 text-xs text-slate-500 dark:text-slate-400 break-all">
              {reason}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
