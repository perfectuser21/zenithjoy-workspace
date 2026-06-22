/**
 * PerCsConfigPage — 每客服设置区（Line04 每客服独立配置）
 *
 * 管理员按「客服微信号」编辑该客服那一行：人设 / 自动回复开关 / 白名单。
 * 保存走 PUT /api/wechat/cs/config/:wechatId（按微信号 key 物理分行，写一行不动别人那行，
 * 钉死 Issue defe1a42 串台）。本页为纯前端表单，后端由中台多租户配置端点承载。
 */
import { useState } from 'react'
import { MessageCircle, Save, Loader2, CheckCircle2 } from 'lucide-react'

interface SavedConfig {
  persona?: { self_name?: string }
}

export default function PerCsConfigPage() {
  const [wechatId, setWechatId] = useState('')
  const [selfName, setSelfName] = useState('')
  const [autoAgent, setAutoAgent] = useState(false)
  const [whitelist, setWhitelist] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto" data-testid="per-cs-config-page">
      <div className="flex items-center gap-2 mb-6">
        <MessageCircle className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">每客服设置区</h1>
      </div>

      <div className="space-y-5 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            客服微信号
          </label>
          <input
            data-testid="cs-wechat-id-input"
            value={wechatId}
            onChange={(e) => setWechatId(e.target.value)}
            placeholder="该客服绑定的微信号，如 wxid_csa"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
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
            placeholder="例如 萌萌"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="cs-auto-agent"
            data-testid="cs-auto-agent-toggle"
            type="checkbox"
            checked={autoAgent}
            onChange={(e) => setAutoAgent(e.target.checked)}
            className="w-4 h-4"
          />
          <label htmlFor="cs-auto-agent" className="text-sm text-gray-700 dark:text-gray-300">
            开启自动回复（真发）；关 = 演练 dryrun
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            白名单（逗号分隔）
          </label>
          <input
            data-testid="cs-whitelist-input"
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
            placeholder="客户甲, 客户乙"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
        </div>

        <button
          data-testid="cs-save-btn"
          onClick={handleSave}
          disabled={saving || !wechatId}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
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
