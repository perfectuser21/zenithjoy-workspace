/**
 * PerCsConfigPage — 每客服设置区（Line04 每客服独立配置）
 *
 * 管理员按「客服微信号」编辑该客服那一行：人设 / 自动回复开关 / 白名单 /
 * 营业时间 start/end / 每日上限（Issue d2987606 补全后端已支持的 8 项配置）。
 * 保存走 PUT /api/wechat/cs/config/:wechatId（按微信号 key 物理分行，写一行不动别人那行，
 * 钉死 Issue defe1a42 串台）。
 *
 * 权限（Issue 96db53be）：进页先拉 GET /api/wechat/cs/my-role 判断 can_config——
 * 非管理员（member / 无 role）整页只读 + 显示「仅管理员可配置」；写接口后端也有同款角色闸兜底。
 */
import { useEffect, useState } from 'react'
import { MessageCircle, Save, Loader2, CheckCircle2, Lock } from 'lucide-react'

interface SavedConfig {
  persona?: { self_name?: string }
}

export default function PerCsConfigPage() {
  const [wechatId, setWechatId] = useState('')
  const [selfName, setSelfName] = useState('')
  const [autoAgent, setAutoAgent] = useState(false)
  const [whitelist, setWhitelist] = useState('')
  const [businessHoursStart, setBusinessHoursStart] = useState('09:00')
  const [businessHoursEnd, setBusinessHoursEnd] = useState('21:00')
  const [dailyLimit, setDailyLimit] = useState('50')
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 权限：deny by default —— my-role 返回 can_config=true 才放开编辑
  const [canConfig, setCanConfig] = useState(false)
  const [roleLoaded, setRoleLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/wechat/cs/my-role')
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as { can_config?: boolean }
        if (alive) setCanConfig(data.can_config === true)
      } catch {
        if (alive) setCanConfig(false) // 拉不到角色 → 当作非管理员只读
      } finally {
        if (alive) setRoleLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 进页若 URL 带 ?wechatId= → 拉该客服已存配置回填（保存成功后刷新页面据此读回新值，Issue d2987606 验收 Step 3）
  useEffect(() => {
    const wid = new URLSearchParams(window.location.search).get('wechatId')
    if (!wid) return
    setWechatId(wid)
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/wechat/cs/config/${encodeURIComponent(wid)}`)
        if (!res.ok) return // 尚无配置（404）等 → 沿用默认值，不阻塞
        const cfg = (await res.json()) as {
          persona?: { self_name?: string }
          auto_agent_enabled?: boolean
          business_hours_start?: string
          business_hours_end?: string
          daily_limit?: number
          whitelist?: string[]
        }
        if (!alive) return
        if (cfg.persona?.self_name != null) setSelfName(cfg.persona.self_name)
        if (typeof cfg.auto_agent_enabled === 'boolean') setAutoAgent(cfg.auto_agent_enabled)
        if (cfg.business_hours_start) setBusinessHoursStart(cfg.business_hours_start)
        if (cfg.business_hours_end) setBusinessHoursEnd(cfg.business_hours_end)
        if (typeof cfg.daily_limit === 'number') setDailyLimit(String(cfg.daily_limit))
        if (Array.isArray(cfg.whitelist)) setWhitelist(cfg.whitelist.join(', '))
      } catch {
        /* 拉不到已存配置不阻塞，沿用默认值 */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSavedName(null)
    try {
      const body = {
        persona: {
          self_name: selfName,
          address_style: '',
          tone: '',
          sentence_style: '',
          use_emoji: '',
          banned_phrases: [] as string[],
          few_shot: [] as { customer: string; me: string }[],
        },
        auto_agent_enabled: autoAgent,
        business_hours_start: businessHoursStart,
        business_hours_end: businessHoursEnd,
        daily_limit: Number.parseInt(dailyLimit, 10) || 0,
        whitelist: whitelist
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }
      const res = await fetch(`/api/wechat/cs/config/${encodeURIComponent(wechatId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`保存失败 (${res.status})`)
      const data = (await res.json()) as { config?: SavedConfig }
      setSavedName(data.config?.persona?.self_name ?? selfName)
      // 持久化 wechatId 到 URL，使刷新页面后能 GET 回填读回新值（Step 3 可观测）
      const u = new URL(window.location.href)
      u.searchParams.set('wechatId', wechatId)
      window.history.replaceState(null, '', u.toString())
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const readOnly = !canConfig
  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className="max-w-2xl mx-auto" data-testid="per-cs-config-page">
      <div className="flex items-center gap-2 mb-6">
        <MessageCircle className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">每客服设置区</h1>
      </div>

      {roleLoaded && readOnly && (
        <div
          data-testid="cs-readonly-notice"
          className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm"
        >
          <Lock className="w-4 h-4" />
          <span>仅管理员可配置（当前账号为只读，如需修改请联系本公司管理员）</span>
        </div>
      )}

      <div className="space-y-5 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            客服微信号
          </label>
          <input
            data-testid="cs-wechat-id-input"
            value={wechatId}
            onChange={(e) => setWechatId(e.target.value)}
            disabled={readOnly}
            placeholder="该客服绑定的微信号，如 wxid_csa"
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            人设（自称）
          </label>
          <input
            data-testid="cs-persona-name-input"
            value={selfName}
            onChange={(e) => setSelfName(e.target.value)}
            disabled={readOnly}
            placeholder="例如 萌萌"
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="cs-auto-agent"
            data-testid="cs-auto-agent-toggle"
            type="checkbox"
            checked={autoAgent}
            onChange={(e) => setAutoAgent(e.target.checked)}
            disabled={readOnly}
            className="w-4 h-4"
          />
          <label htmlFor="cs-auto-agent" className="text-sm text-gray-700 dark:text-gray-300">
            开启自动回复（真发）；关 = 演练 dryrun
          </label>
        </div>

        {/* 营业时间（Issue d2987606 补全）：名单内客户也只在营业时段内自动回 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              营业时间（开始）
            </label>
            <input
              data-testid="cs-business-hours-start"
              type="time"
              value={businessHoursStart}
              onChange={(e) => setBusinessHoursStart(e.target.value)}
              disabled={readOnly}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              营业时间（结束）
            </label>
            <input
              data-testid="cs-business-hours-end"
              type="time"
              value={businessHoursEnd}
              onChange={(e) => setBusinessHoursEnd(e.target.value)}
              disabled={readOnly}
              className={inputCls}
            />
          </div>
        </div>

        {/* 每日上限（Issue d2987606 补全）：每号每日自动回上限，0 = 不限 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            每日上限（每号每日自动回条数，0 = 不限）
          </label>
          <input
            data-testid="cs-daily-limit"
            type="number"
            min={0}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            disabled={readOnly}
            placeholder="50"
            className={inputCls}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            白名单（逗号分隔）
          </label>
          <input
            data-testid="cs-whitelist-input"
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
            disabled={readOnly}
            placeholder="客户甲, 客户乙"
            className={inputCls}
          />
        </div>

        <button
          data-testid="cs-save-btn"
          onClick={handleSave}
          disabled={saving || !wechatId || readOnly}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存该客服配置
        </button>

        {savedName && (
          <div
            data-testid="cs-save-success"
            className="flex items-center gap-2 text-green-600 dark:text-green-400"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>保存成功</span>
          </div>
        )}

        {savedName && (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            当前人设：<span data-testid="cs-persona-name-result">{savedName}</span>
          </div>
        )}

        {error && (
          <div data-testid="cs-save-error" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
