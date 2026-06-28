/**
 * WechatCustomerServiceConfigPage — 微信客服「话术知识库」页（IA 重设计刀1：每号编辑）
 *
 * 反转「全局编辑」：顶部加【客服号选择器】，persona + business_kb 都按某个号读写——
 *   - GET /wechat/cs/machines → 号列表（运营只看自己租户的号，超管看全部 = 既有 scope）
 *   - GET /wechat/cs/config/:wechatId → 该号完整 persona + business_kb 填表
 *   - PUT /wechat/cs/config/:wechatId → 保存该号 persona + business_kb（行级 merge，不碰运营参数）
 * 每号一份人设+知识库，物理上不可能与「客服机」页重复（人设名 self_name 也归到这里）。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  MessageCircle,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  Sparkles,
  Users,
} from 'lucide-react'
import {
  listCSMachines,
  getCSAccountConfig,
  saveCSAccountConfig,
  suggestAudience,
  type Persona,
  type BusinessKB,
  type CSMachine,
} from '../api/wechat-cs-config.api'
import Line04PreflightCard from '../components/Line04PreflightCard'
import ListenerHealthSection from '../components/ListenerHealthSection'

// ─── 默认空值 ─────────────────────────────────────────────────

const EMPTY_PERSONA: Persona = {
  self_name: '',
  address_style: '',
  tone: '',
  sentence_style: '',
  use_emoji: '',
  banned_phrases: [],
  few_shot: [],
}

const EMPTY_KB: BusinessKB = {
  company: { name: '', what_we_do: '', value_prop: '', contact: '' },
  products: [],
  audience_segments: [],
  qa_docs: [],
}

// ─── 共享样式 ─────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'

const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1'

// ─── 区块容器 ─────────────────────────────────────────────────

function Section({
  title,
  desc,
  onSave,
  saving,
  children,
  extraAction,
}: {
  title: string
  desc?: string
  onSave: () => void
  saving: boolean
  children: React.ReactNode
  extraAction?: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
          {desc && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{desc}</p>}
        </div>
        <div className="flex items-center gap-2">
          {extraAction}
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            保存
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}

// ─── 增删行小工具 ─────────────────────────────────────────────

function RowActions({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      onClick={onRemove}
      className="flex-shrink-0 p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
      title="删除"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────

export default function WechatCustomerServiceConfigPage() {
  const [persona, setPersona] = useState<Persona>(EMPTY_PERSONA)
  const [kb, setKb] = useState<BusinessKB>(EMPTY_KB)
  const [machines, setMachines] = useState<CSMachine[]>([])
  const [selectedWechatId, setSelectedWechatId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [savingPersona, setSavingPersona] = useState(false)
  const [savingCompany, setSavingCompany] = useState(false)
  const [savingProducts, setSavingProducts] = useState(false)
  const [savingAudience, setSavingAudience] = useState(false)
  const [savingQa, setSavingQa] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const notify = (type: 'success' | 'error', text: string) => setMessage({ type, text })

  // 加载某个号的 persona + business_kb 填表（无配置 → 空默认）。
  const loadConfig = useCallback(async (wechatId: string) => {
    if (!wechatId) {
      setPersona(EMPTY_PERSONA)
      setKb(EMPTY_KB)
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const cfg = await getCSAccountConfig(wechatId)
      setPersona({ ...EMPTY_PERSONA, ...(cfg?.persona ?? {}) })
      setKb({ ...EMPTY_KB, ...(cfg?.business_kb ?? {}) })
    } catch {
      notify('error', '加载该号配置失败')
    }
    setLoading(false)
  }, [])

  // 首次：拉号列表（已 scope），默认选第一个已配号。
  const loadMachines = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const list = (await listCSMachines()).filter((m) => m.configured && m.wechat_id)
      setMachines(list)
      const first = list[0]?.wechat_id ?? ''
      setSelectedWechatId(first)
      await loadConfig(first)
    } catch {
      notify('error', '加载客服号失败')
      setLoading(false)
    }
  }, [loadConfig])

  useEffect(() => {
    loadMachines()
  }, [loadMachines])

  // 切换号 → 重新加载该号配置。
  const onSelectAccount = async (wechatId: string) => {
    setSelectedWechatId(wechatId)
    await loadConfig(wechatId)
  }

  // 统一保存：每次都 PUT 该号的 {persona, business_kb}（后端行级 merge，不碰运营参数）。
  const persistAccount = async (
    nextPersona: Persona,
    nextKb: BusinessKB,
    setSaving: (v: boolean) => void,
    okText: string
  ) => {
    if (!selectedWechatId) {
      notify('error', '请先选择一个客服号')
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await saveCSAccountConfig(selectedWechatId, { persona: nextPersona, business_kb: nextKb })
      setPersona(nextPersona)
      setKb(nextKb)
      notify('success', okText)
    } catch {
      notify('error', '保存失败')
    }
    setSaving(false)
  }

  // ─── 保存：人设（每号）───────────────────────────────────────
  const handleSavePersona = () => persistAccount(persona, kb, setSavingPersona, '人设已保存')

  // ─── 保存：企业信息 / 产品 / 人群 / Q&A（都写该号 business_kb，连带 persona 一起 PUT）──
  const saveKbWith = (next: BusinessKB, setSaving: (v: boolean) => void, okText: string) =>
    persistAccount(persona, next, setSaving, okText)

  // ─── AI 帮我生成 A1–A5 ─────────────────────────────────────
  const handleSuggestAudience = async () => {
    setSuggesting(true)
    setMessage(null)
    try {
      const productsText = kb.products.map((p) => p.name).filter(Boolean).join('、')
      const res = await suggestAudience({
        industry: kb.company.what_we_do || kb.company.name,
        products: productsText || undefined,
        value_prop: kb.company.value_prop || undefined,
      })
      if (res.audience_segments && res.audience_segments.length > 0) {
        setKb((prev) => ({ ...prev, audience_segments: res.audience_segments }))
        notify('success', `AI 生成了 ${res.audience_segments.length} 组人群，记得检查后保存`)
      } else {
        notify('error', 'AI 没有返回人群，请补充企业信息后重试')
      }
    } catch {
      notify('error', 'AI 生成失败')
    }
    setSuggesting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      {/* 顶栏 */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-[960px] mx-auto px-6 py-4 flex items-center gap-3">
          <MessageCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">微信客服 · 话术知识库（每号）</h1>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className="max-w-[960px] mx-auto px-6 pt-4">
          <div
            className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertCircle className="w-4 h-4" />
            )}
            {message.text}
          </div>
        </div>
      )}

      {/* 主内容 */}
      <div className="max-w-[960px] mx-auto px-6 py-6">
        {/* ─── 本机环境状态（Line04 preflight 结果，顶部）── */}
        <Line04PreflightCard />

        {/* ─── 监听健康 ─────────────────────────────────── */}
        <ListenerHealthSection />

        {/* ─── 客服号选择器（每号编辑）──────────────────── */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 mb-5">
          <div className="flex items-center gap-3">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div className="flex-1">
              <label className={labelCls}>编辑哪个客服号的人设 / 知识库</label>
              {machines.length > 0 ? (
                <select
                  data-testid="cs-account-selector"
                  className={inputCls}
                  value={selectedWechatId}
                  onChange={(e) => onSelectAccount(e.target.value)}
                >
                  {machines.map((m) => (
                    <option key={m.wechat_id} value={m.wechat_id}>
                      {(m.self_name || m.hostname || m.wechat_id) +
                        (m.real_wechat_id ? `（${m.real_wechat_id}）` : '')}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  还没有已配置的客服号。请先去「客服机」页选机器、绑定一个客服号，再回来配人设/知识库。
                </p>
              )}
            </div>
          </div>
        </div>

        {machines.length === 0 ? null : (
        <>
        {/* ─── 人设 ─────────────────────────────────────── */}
        <Section
          title="人设"
          desc="AI 客服扮演的角色：自称、称呼、语气、句长、emoji、禁用词、示范对话"
          onSave={handleSavePersona}
          saving={savingPersona}
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>我的自称</label>
              <input
                data-testid="persona-self-name"
                className={inputCls}
                value={persona.self_name}
                onChange={(e) => setPersona({ ...persona, self_name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>怎么称呼客户</label>
              <input
                className={inputCls}
                value={persona.address_style}
                onChange={(e) => setPersona({ ...persona, address_style: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>语气基调</label>
              <input
                className={inputCls}
                value={persona.tone}
                onChange={(e) => setPersona({ ...persona, tone: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>句长 / 拆句偏好</label>
              <input
                className={inputCls}
                value={persona.sentence_style}
                onChange={(e) => setPersona({ ...persona, sentence_style: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>emoji 使用习惯</label>
              <input
                className={inputCls}
                value={persona.use_emoji}
                onChange={(e) => setPersona({ ...persona, use_emoji: e.target.value })}
              />
            </div>
          </div>

          {/* 禁用词数组 */}
          <div className="mt-5">
            <label className={labelCls}>禁用词 / 禁用腔</label>
            {persona.banned_phrases.map((phrase, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input
                  data-testid="persona-banned-phrase"
                  className={inputCls}
                  value={phrase}
                  onChange={(e) => {
                    const next = [...persona.banned_phrases]
                    next[i] = e.target.value
                    setPersona({ ...persona, banned_phrases: next })
                  }}
                />
                <RowActions
                  onRemove={() =>
                    setPersona({
                      ...persona,
                      banned_phrases: persona.banned_phrases.filter((_, idx) => idx !== i),
                    })
                  }
                />
              </div>
            ))}
            <AddRowButton
              label="添加禁用词"
              onClick={() =>
                setPersona({ ...persona, banned_phrases: [...persona.banned_phrases, ''] })
              }
            />
          </div>

          {/* few-shot 数组 */}
          <div className="mt-5">
            <label className={labelCls}>示范对话（few-shot）</label>
            {persona.few_shot.map((fs, i) => (
              <div
                key={i}
                className="flex items-start gap-2 mb-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700"
              >
                <div className="flex-1 grid grid-cols-1 gap-2">
                  <input
                    className={inputCls}
                    placeholder="客户这么说"
                    value={fs.customer}
                    onChange={(e) => {
                      const next = [...persona.few_shot]
                      next[i] = { ...next[i], customer: e.target.value }
                      setPersona({ ...persona, few_shot: next })
                    }}
                  />
                  <input
                    className={inputCls}
                    placeholder="我会这么回"
                    value={fs.me}
                    onChange={(e) => {
                      const next = [...persona.few_shot]
                      next[i] = { ...next[i], me: e.target.value }
                      setPersona({ ...persona, few_shot: next })
                    }}
                  />
                </div>
                <RowActions
                  onRemove={() =>
                    setPersona({
                      ...persona,
                      few_shot: persona.few_shot.filter((_, idx) => idx !== i),
                    })
                  }
                />
              </div>
            ))}
            <AddRowButton
              label="添加示范对话"
              onClick={() =>
                setPersona({
                  ...persona,
                  few_shot: [...persona.few_shot, { customer: '', me: '' }],
                })
              }
            />
          </div>
        </Section>

        {/* ─── 企业信息 ─────────────────────────────────── */}
        <Section
          title="企业信息"
          desc="公司名 / 我们做什么 / 价值主张 / 联系方式"
          onSave={() => saveKbWith(kb, setSavingCompany, '企业信息已保存')}
          saving={savingCompany}
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>公司名</label>
              <input
                data-testid="company-name"
                className={inputCls}
                value={kb.company.name}
                onChange={(e) => setKb({ ...kb, company: { ...kb.company, name: e.target.value } })}
              />
            </div>
            <div>
              <label className={labelCls}>联系方式</label>
              <input
                className={inputCls}
                value={kb.company.contact}
                onChange={(e) =>
                  setKb({ ...kb, company: { ...kb.company, contact: e.target.value } })
                }
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>我们做什么</label>
              <input
                className={inputCls}
                value={kb.company.what_we_do}
                onChange={(e) =>
                  setKb({ ...kb, company: { ...kb.company, what_we_do: e.target.value } })
                }
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>价值主张</label>
              <input
                className={inputCls}
                value={kb.company.value_prop}
                onChange={(e) =>
                  setKb({ ...kb, company: { ...kb.company, value_prop: e.target.value } })
                }
              />
            </div>
          </div>
        </Section>

        {/* ─── 产品信息 ─────────────────────────────────── */}
        <Section
          title="产品信息"
          desc="产品名 / 卖点 / 价格（可选）"
          onSave={() => saveKbWith(kb, setSavingProducts, '产品信息已保存')}
          saving={savingProducts}
        >
          {kb.products.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-2 mb-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="flex-1 grid grid-cols-1 gap-2">
                <input
                  data-testid="product-name"
                  className={inputCls}
                  placeholder="产品名"
                  value={p.name}
                  onChange={(e) => {
                    const next = [...kb.products]
                    next[i] = { ...next[i], name: e.target.value }
                    setKb({ ...kb, products: next })
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="卖点"
                  value={p.selling_points}
                  onChange={(e) => {
                    const next = [...kb.products]
                    next[i] = { ...next[i], selling_points: e.target.value }
                    setKb({ ...kb, products: next })
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="价格（可选）"
                  value={p.price ?? ''}
                  onChange={(e) => {
                    const next = [...kb.products]
                    next[i] = { ...next[i], price: e.target.value }
                    setKb({ ...kb, products: next })
                  }}
                />
              </div>
              <RowActions
                onRemove={() =>
                  setKb({ ...kb, products: kb.products.filter((_, idx) => idx !== i) })
                }
              />
            </div>
          ))}
          <AddRowButton
            label="添加产品"
            onClick={() =>
              setKb({
                ...kb,
                products: [...kb.products, { name: '', selling_points: '', price: '' }],
              })
            }
          />
        </Section>

        {/* ─── 目标人群 ─────────────────────────────────── */}
        <Section
          title="目标人群"
          desc="A1–A5 人群画像：code / 标签 / 描述。可点「AI 帮我生成」自动填，再人工修改后保存"
          onSave={() => saveKbWith(kb, setSavingAudience, '目标人群已保存')}
          saving={savingAudience}
          extraAction={
            <button
              data-testid="suggest-audience-btn"
              onClick={handleSuggestAudience}
              disabled={suggesting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/40 hover:bg-purple-200 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {suggesting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              AI 帮我生成 A1–A5
            </button>
          }
        >
          {kb.audience_segments.map((seg, i) => (
            <div
              key={i}
              className="flex items-start gap-2 mb-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="flex-1 grid grid-cols-[80px_1fr] gap-2">
                <input
                  data-testid="audience-code"
                  className={inputCls}
                  placeholder="A1"
                  value={seg.code}
                  onChange={(e) => {
                    const next = [...kb.audience_segments]
                    next[i] = { ...next[i], code: e.target.value }
                    setKb({ ...kb, audience_segments: next })
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="标签"
                  value={seg.label}
                  onChange={(e) => {
                    const next = [...kb.audience_segments]
                    next[i] = { ...next[i], label: e.target.value }
                    setKb({ ...kb, audience_segments: next })
                  }}
                />
                <input
                  className={`${inputCls} col-span-2`}
                  placeholder="描述"
                  value={seg.desc}
                  onChange={(e) => {
                    const next = [...kb.audience_segments]
                    next[i] = { ...next[i], desc: e.target.value }
                    setKb({ ...kb, audience_segments: next })
                  }}
                />
              </div>
              <RowActions
                onRemove={() =>
                  setKb({
                    ...kb,
                    audience_segments: kb.audience_segments.filter((_, idx) => idx !== i),
                  })
                }
              />
            </div>
          ))}
          <AddRowButton
            label="添加人群"
            onClick={() =>
              setKb({
                ...kb,
                audience_segments: [
                  ...kb.audience_segments,
                  { code: '', label: '', desc: '' },
                ],
              })
            }
          />
        </Section>

        {/* ─── 常用文档 / Q&A ───────────────────────────── */}
        <Section
          title="常用文档 / Q&A"
          desc="常见问题与标准答复"
          onSave={() => saveKbWith(kb, setSavingQa, 'Q&A 已保存')}
          saving={savingQa}
        >
          {kb.qa_docs.map((qa, i) => (
            <div
              key={i}
              className="flex items-start gap-2 mb-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="flex-1 grid grid-cols-1 gap-2">
                <input
                  data-testid="qa-question"
                  className={inputCls}
                  placeholder="问题"
                  value={qa.q}
                  onChange={(e) => {
                    const next = [...kb.qa_docs]
                    next[i] = { ...next[i], q: e.target.value }
                    setKb({ ...kb, qa_docs: next })
                  }}
                />
                <input
                  className={inputCls}
                  placeholder="答复"
                  value={qa.a}
                  onChange={(e) => {
                    const next = [...kb.qa_docs]
                    next[i] = { ...next[i], a: e.target.value }
                    setKb({ ...kb, qa_docs: next })
                  }}
                />
              </div>
              <RowActions
                onRemove={() =>
                  setKb({ ...kb, qa_docs: kb.qa_docs.filter((_, idx) => idx !== i) })
                }
              />
            </div>
          ))}
          <AddRowButton
            label="添加 Q&A"
            onClick={() => setKb({ ...kb, qa_docs: [...kb.qa_docs, { q: '', a: '' }] })}
          />
        </Section>
        </>
        )}
      </div>
    </div>
  )
}
