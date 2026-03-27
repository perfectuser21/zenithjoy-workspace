import { useState, useEffect, useCallback } from 'react'
import {
  Settings,
  Save,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Trash2,
  Upload,
  Search,
  FileText,
  Image,
  Eye,
  Send,
  BookOpen,
  Pen,
} from 'lucide-react'

// ─── 类型 ─────────────────────────────────────────────────────

interface ContentTypeConfig {
  content_type: string
  source: string
  config: PipelineConfig
  updated_at: string
}

interface PipelineConfig {
  research?: StepConfig
  copywriting?: StepConfig
  copy_review?: ReviewStepConfig
  generate?: GenerateStepConfig
  image_review?: ReviewStepConfig
  export?: ExportStepConfig
  [key: string]: unknown
}

interface StepConfig {
  prompt?: string
  rules?: string[]
  [key: string]: unknown
}

interface ReviewStepConfig extends StepConfig {
  review_rules?: string[]
  review_prompt?: string
}

interface GenerateStepConfig extends StepConfig {
  images_count?: number
  format?: string
  style?: string
  aspect_ratio?: string
}

interface ExportStepConfig extends StepConfig {
  platforms?: string[]
  hashtags?: string[]
  outputs?: string[]
}

// ─── Tab 定义 ─────────────────────────────────────────────────

const TABS = [
  { key: 'research', label: '调研', icon: Search },
  { key: 'copywriting', label: '文案', icon: Pen },
  { key: 'copy_review', label: '文案审核', icon: Eye },
  { key: 'generate', label: '图片', icon: Image },
  { key: 'image_review', label: '图片审核', icon: Eye },
  { key: 'export', label: '导出', icon: Send },
] as const

type TabKey = typeof TABS[number]['key']

// ─── API ──────────────────────────────────────────────────────

async function fetchContentTypes(): Promise<string[]> {
  const res = await fetch('/api/brain/content-types')
  if (!res.ok) return []
  return res.json()
}

async function fetchTypeConfig(type: string): Promise<ContentTypeConfig | null> {
  const res = await fetch(`/api/brain/content-types/${encodeURIComponent(type)}/config`)
  if (!res.ok) return null
  return res.json()
}

async function saveTypeConfig(type: string, config: PipelineConfig): Promise<boolean> {
  const res = await fetch(`/api/brain/content-types/${encodeURIComponent(type)}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  return res.ok
}

async function seedFromYaml(): Promise<{ success: boolean; message?: string }> {
  const res = await fetch('/api/brain/content-types/seed', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  return { success: res.ok, message: data.message || data.error }
}

// ─── 可增删列表组件 ───────────────────────────────────────────

function EditableList({
  items,
  onChange,
  placeholder = '输入内容...',
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
}) {
  const addItem = () => onChange([...items, ''])
  const removeItem = (i: number) => onChange(items.filter((_, idx) => idx !== i))
  const updateItem = (i: number, val: string) => {
    const next = [...items]
    next[i] = val
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            value={item}
            onChange={e => updateItem(i, e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={() => removeItem(i)}
            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        onClick={addItem}
        className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
      >
        <Plus className="w-4 h-4" />
        添加
      </button>
    </div>
  )
}

// ─── Tab 内容面板 ─────────────────────────────────────────────

function ResearchPanel({
  config,
  onChange,
}: {
  config: StepConfig
  onChange: (c: StepConfig) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <BookOpen className="w-4 h-4 inline mr-1" />
          调研 Prompt
        </label>
        <textarea
          value={config.prompt || ''}
          onChange={e => onChange({ ...config, prompt: e.target.value })}
          placeholder="输入调研阶段的 prompt..."
          className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          style={{ minHeight: 200 }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          调研规则
        </label>
        <EditableList
          items={config.rules || []}
          onChange={rules => onChange({ ...config, rules })}
          placeholder="输入调研规则..."
        />
      </div>
    </div>
  )
}

function CopywritingPanel({
  config,
  onChange,
}: {
  config: StepConfig
  onChange: (c: StepConfig) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <Pen className="w-4 h-4 inline mr-1" />
          文案生成 Prompt
        </label>
        <textarea
          value={config.prompt || ''}
          onChange={e => onChange({ ...config, prompt: e.target.value })}
          placeholder="输入文案生成的 prompt..."
          className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          style={{ minHeight: 200 }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          写作规则
        </label>
        <EditableList
          items={config.rules || []}
          onChange={rules => onChange({ ...config, rules })}
          placeholder="输入写作规则..."
        />
      </div>
    </div>
  )
}

function ReviewPanel({
  config,
  onChange,
  title,
}: {
  config: ReviewStepConfig
  onChange: (c: ReviewStepConfig) => void
  title: string
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <Eye className="w-4 h-4 inline mr-1" />
          {title} Prompt
        </label>
        <textarea
          value={config.review_prompt || config.prompt || ''}
          onChange={e => onChange({ ...config, review_prompt: e.target.value })}
          placeholder={`输入${title}的 prompt...`}
          className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          style={{ minHeight: 200 }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          审核规则
        </label>
        <EditableList
          items={config.review_rules || config.rules || []}
          onChange={review_rules => onChange({ ...config, review_rules })}
          placeholder="输入审核规则..."
        />
      </div>
    </div>
  )
}

function GeneratePanel({
  config,
  onChange,
}: {
  config: GenerateStepConfig
  onChange: (c: GenerateStepConfig) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <Image className="w-4 h-4 inline mr-1" />
          图片生成 Prompt
        </label>
        <textarea
          value={config.prompt || ''}
          onChange={e => onChange({ ...config, prompt: e.target.value })}
          placeholder="输入图片生成的 prompt..."
          className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          style={{ minHeight: 200 }}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            图片数量
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={config.images_count || 1}
            onChange={e => onChange({ ...config, images_count: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            格式
          </label>
          <input
            type="text"
            value={config.format || ''}
            onChange={e => onChange({ ...config, format: e.target.value })}
            placeholder="如: png, jpg"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            风格
          </label>
          <input
            type="text"
            value={config.style || ''}
            onChange={e => onChange({ ...config, style: e.target.value })}
            placeholder="如: 商务、清新、科技"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            宽高比
          </label>
          <input
            type="text"
            value={config.aspect_ratio || ''}
            onChange={e => onChange({ ...config, aspect_ratio: e.target.value })}
            placeholder="如: 9:16, 1:1, 16:9"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  )
}

function ExportPanel({
  config,
  onChange,
}: {
  config: ExportStepConfig
  onChange: (c: ExportStepConfig) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <Send className="w-4 h-4 inline mr-1" />
          导出 Prompt
        </label>
        <textarea
          value={config.prompt || ''}
          onChange={e => onChange({ ...config, prompt: e.target.value })}
          placeholder="输入导出阶段的 prompt..."
          className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
          style={{ minHeight: 120 }}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          发布平台
        </label>
        <EditableList
          items={config.platforms || []}
          onChange={platforms => onChange({ ...config, platforms })}
          placeholder="如: xiaohongshu, douyin, weibo"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          话题标签
        </label>
        <EditableList
          items={config.hashtags || []}
          onChange={hashtags => onChange({ ...config, hashtags })}
          placeholder="如: #成长 #创业"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          输出格式
        </label>
        <EditableList
          items={config.outputs || []}
          onChange={outputs => onChange({ ...config, outputs })}
          placeholder="如: notion, markdown, json"
        />
      </div>
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────

export default function ContentTypeConfigPage() {
  const [types, setTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [config, setConfig] = useState<PipelineConfig | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('research')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string>('')
  const [configSource, setConfigSource] = useState<string>('')

  // 加载内容类型列表
  const loadTypes = useCallback(async () => {
    const data = await fetchContentTypes()
    setTypes(data)
  }, [])

  useEffect(() => { loadTypes() }, [loadTypes])

  // 选中类型后加载配置
  const loadConfig = useCallback(async (type: string) => {
    setLoading(true)
    setMessage(null)
    const data = await fetchTypeConfig(type)
    if (data) {
      setConfig(data.config)
      setConfigUpdatedAt(data.updated_at)
      setConfigSource(data.source)
    } else {
      setConfig({})
      setConfigUpdatedAt('')
      setConfigSource('')
      setMessage({ type: 'error', text: '加载配置失败' })
    }
    setLoading(false)
  }, [])

  const selectType = (type: string) => {
    setSelectedType(type)
    setActiveTab('research')
    loadConfig(type)
  }

  // 更新某个 tab 对应的步骤配置
  const updateStepConfig = (key: TabKey, stepConfig: StepConfig) => {
    if (!config) return
    setConfig({ ...config, [key]: stepConfig })
  }

  // 保存
  const handleSave = async () => {
    if (!selectedType || !config) return
    setSaving(true)
    setMessage(null)
    const ok = await saveTypeConfig(selectedType, config)
    if (ok) {
      setMessage({ type: 'success', text: '保存成功' })
      setConfigUpdatedAt(new Date().toISOString())
    } else {
      setMessage({ type: 'error', text: '保存失败' })
    }
    setSaving(false)
  }

  // 从 YAML 初始化
  const handleSeed = async () => {
    setSeeding(true)
    setMessage(null)
    const result = await seedFromYaml()
    if (result.success) {
      setMessage({ type: 'success', text: result.message || '初始化成功' })
      await loadTypes()
      if (selectedType) await loadConfig(selectedType)
    } else {
      setMessage({ type: 'error', text: result.message || '初始化失败' })
    }
    setSeeding(false)
  }

  // 渲染当前 tab 的编辑面板
  const renderTabContent = () => {
    if (!config) return null
    const stepConfig = (config[activeTab] as StepConfig) || {}

    switch (activeTab) {
      case 'research':
        return <ResearchPanel config={stepConfig} onChange={c => updateStepConfig('research', c)} />
      case 'copywriting':
        return <CopywritingPanel config={stepConfig} onChange={c => updateStepConfig('copywriting', c)} />
      case 'copy_review':
        return <ReviewPanel config={stepConfig as ReviewStepConfig} onChange={c => updateStepConfig('copy_review', c)} title="文案审核" />
      case 'generate':
        return <GeneratePanel config={stepConfig as GenerateStepConfig} onChange={c => updateStepConfig('generate', c)} />
      case 'image_review':
        return <ReviewPanel config={stepConfig as ReviewStepConfig} onChange={c => updateStepConfig('image_review', c)} title="图片审核" />
      case 'export':
        return <ExportPanel config={stepConfig as ExportStepConfig} onChange={c => updateStepConfig('export', c)} />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      {/* 顶栏 */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              内容类型配置管理
            </h1>
          </div>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
          >
            {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            从 YAML 初始化
          </button>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {message.text}
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex gap-6" style={{ minHeight: 'calc(100vh - 160px)' }}>
          {/* 左侧 - 内容类型列表 */}
          <div className="w-64 flex-shrink-0">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  内容类型
                </h2>
                <button
                  onClick={loadTypes}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
                  title="刷新"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {types.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                    暂无内容类型
                    <br />
                    <span className="text-xs">点击右上角「从 YAML 初始化」导入</span>
                  </div>
                ) : (
                  types.map(type => (
                    <button
                      key={type}
                      onClick={() => selectType(type)}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                        selectedType === type
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        {type}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 右侧 - 配置编辑器 */}
          <div className="flex-1">
            {!selectedType ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-slate-400 dark:text-slate-500">
                  <Settings className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-lg">选择一个内容类型开始编辑</p>
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* 类型标题 + 元信息 */}
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                      {selectedType}
                    </h2>
                    <div className="flex items-center gap-4 mt-1 text-xs text-slate-400 dark:text-slate-500">
                      {configSource && <span>来源: {configSource}</span>}
                      {configUpdatedAt && (
                        <span>
                          更新于: {new Date(configUpdatedAt).toLocaleString('zh-CN', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存配置
                  </button>
                </div>

                {/* 6 个 Tab */}
                <div className="border-b border-slate-200 dark:border-slate-700 px-6 flex gap-1 overflow-x-auto">
                  {TABS.map(tab => {
                    const Icon = tab.icon
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                          activeTab === tab.key
                            ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                            : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                {/* Tab 内容 */}
                <div className="p-6">
                  {renderTabContent()}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
