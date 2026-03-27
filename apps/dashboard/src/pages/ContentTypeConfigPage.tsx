import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Settings,
  Save,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Upload,
  FileText,
  Play,
  Clock,
  Zap,
  ChevronDown,
} from 'lucide-react'

// ─── 节点定义 ─────────────────────────────────────────────────

const PIPELINE_NODES = [
  {
    key: 'content-research',
    label: '调研',
    icon: '\u{1F50D}',
    promptField: 'template.research_prompt',
    inputDesc: '关键词',
    outputDesc: 'findings 调研结果',
    configKey: 'research',
  },
  {
    key: 'content-copywriting',
    label: '文案生成',
    icon: '\u270D\uFE0F',
    promptField: 'template.generate_prompt',
    inputDesc: '关键词 + 调研结果',
    outputDesc: '社媒文案 + 公众号长文',
    configKey: 'copywriting',
  },
  {
    key: 'content-copy-review',
    label: '文案审核',
    icon: '\u{1F4CB}',
    promptField: 'template.review_prompt',
    inputDesc: '文案内容',
    outputDesc: 'PASS/FAIL + 问题列表',
    configKey: 'copy_review',
  },
  {
    key: 'content-generate',
    label: '图片生成',
    icon: '\u{1F5BC}\uFE0F',
    promptField: 'template.image_prompt',
    inputDesc: '定稿文案',
    outputDesc: '9:16 卡片 \u00D7 N',
    configKey: 'generate',
  },
  {
    key: 'content-image-review',
    label: '图片审核',
    icon: '\u{1F441}\uFE0F',
    promptField: 'template.image_review_prompt',
    inputDesc: '图片文件',
    outputDesc: 'PASS/FAIL + 问题列表',
    configKey: 'image_review',
  },
  {
    key: 'content-export',
    label: '导出',
    icon: '\u{1F4E6}',
    promptField: 'template.export_prompt',
    inputDesc: '全部产物',
    outputDesc: 'manifest + 发布任务',
    configKey: 'export',
  },
] as const

type NodeKey = (typeof PIPELINE_NODES)[number]['key']

const MODEL_OPTIONS = [
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'claude-opus', label: 'Claude Opus' },
  { value: 'gpt-4o', label: 'GPT-4o' },
]

// ─── 类型 ─────────────────────────────────────────────────────

interface ContentTypeConfig {
  content_type: string
  source: string
  config: PipelineConfig
  updated_at: string
}

interface PipelineConfig {
  [key: string]: unknown
}

interface TestResult {
  output: string
  duration_ms: number
  tokens?: { input: number; output: number }
  error?: string
}

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

async function testStep(payload: {
  step: string
  prompt: string
  model: string
  input: Record<string, unknown>
}): Promise<TestResult> {
  const res = await fetch('/api/brain/content-types/test-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '测试服务准备中' }))
    return { output: '', duration_ms: 0, error: err.error || err.message || '测试服务准备中' }
  }
  return res.json()
}

// ─── 辅助：获取/设置嵌套字段 ──────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part]
    } else {
      return ''
    }
  }
  return typeof current === 'string' ? current : ''
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const parts = path.split('.')
  const result = { ...obj }
  let current: Record<string, unknown> = result
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {}
    } else {
      current[part] = { ...(current[part] as Record<string, unknown>) }
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
  return result
}

// ─── 流水线可视化 ──────────────────────────────────────────────

function PipelineVisualizer({
  selectedNode,
  onSelectNode,
}: {
  selectedNode: NodeKey | null
  onSelectNode: (key: NodeKey) => void
}) {
  const _containerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative" ref={_containerRef}>
      <div className="flex items-center justify-between gap-2 px-4">
        {PIPELINE_NODES.map((node, idx) => {
          const isSelected = selectedNode === node.key
          return (
            <div key={node.key} className="flex items-center flex-1 min-w-0">
              {/* 节点卡片 */}
              <button
                onClick={() => onSelectNode(node.key)}
                className={`
                  relative flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl
                  border-2 transition-all duration-200 cursor-pointer w-full min-w-[100px]
                  ${isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-lg shadow-blue-500/20 scale-105'
                    : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-md'
                  }
                `}
              >
                <span className="text-2xl">{node.icon}</span>
                <span className={`text-xs font-semibold truncate max-w-full ${
                  isSelected
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-slate-600 dark:text-slate-400'
                }`}>
                  {node.label}
                </span>
                {isSelected && (
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                    <ChevronDown className="w-4 h-4 text-blue-500" />
                  </div>
                )}
              </button>

              {/* 连接箭头 */}
              {idx < PIPELINE_NODES.length - 1 && (
                <div className="flex items-center mx-1 flex-shrink-0">
                  <svg width="32" height="12" viewBox="0 0 32 12" className="flex-shrink-0">
                    <line
                      x1="0" y1="6" x2="24" y2="6"
                      className="stroke-slate-300 dark:stroke-slate-600"
                      strokeWidth="2"
                    />
                    <polygon
                      points="24,1 32,6 24,11"
                      className="fill-slate-300 dark:fill-slate-600"
                    />
                  </svg>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 节点详情面板 ──────────────────────────────────────────────

function NodeDetailPanel({
  node,
  prompt,
  onPromptChange,
  model,
  onModelChange,
  onTest,
  onSave,
  testResult,
  testing,
  saving,
}: {
  node: (typeof PIPELINE_NODES)[number]
  prompt: string
  onPromptChange: (v: string) => void
  model: string
  onModelChange: (v: string) => void
  onTest: () => void
  onSave: () => void
  testResult: TestResult | null
  testing: boolean
  saving: boolean
}) {
  return (
    <div className="mt-6 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* 标题栏 */}
      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{node.icon}</span>
          <h3 className="font-semibold text-slate-900 dark:text-white">{node.label}</h3>
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">{node.key}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700">{node.promptField}</span>
        </div>
      </div>

      {/* 三栏内容 */}
      <div className="grid grid-cols-12 divide-x divide-slate-200 dark:divide-slate-700" style={{ minHeight: 400 }}>
        {/* 左：输入 */}
        <div className="col-span-2 p-4">
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Input
          </h4>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-1">输入数据</div>
              <div className="text-sm text-green-600 dark:text-green-400">{node.inputDesc}</div>
            </div>
            {PIPELINE_NODES.findIndex(n => n.key === node.key) > 0 && (
              <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1">
                <Zap className="w-3 h-3" />
                来自上一步输出
              </div>
            )}
          </div>
        </div>

        {/* 中：Prompt 编辑器 */}
        <div className="col-span-6 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Prompt
            </h4>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 dark:text-slate-500">模型</label>
              <select
                value={model}
                onChange={e => onModelChange(e.target.value)}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {MODEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={e => onPromptChange(e.target.value)}
            placeholder={`编辑 ${node.label} 的 prompt...`}
            className="flex-1 w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            style={{ minHeight: 280 }}
          />

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={onTest}
              disabled={testing || !prompt.trim()}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              测试
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存
            </button>
          </div>
        </div>

        {/* 右：输出 */}
        <div className="col-span-4 p-4 flex flex-col">
          <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Output
          </h4>

          <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 mb-3">
            <div className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">预期输出</div>
            <div className="text-sm text-purple-600 dark:text-purple-400">{node.outputDesc}</div>
          </div>

          {testing && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
                <div className="text-sm text-slate-400">执行中...</div>
              </div>
            </div>
          )}

          {!testing && testResult && (
            <div className="flex-1 flex flex-col min-h-0">
              {testResult.error ? (
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300 text-sm font-medium mb-1">
                    <AlertCircle className="w-4 h-4" />
                    测试失败
                  </div>
                  <div className="text-sm text-red-600 dark:text-red-400">{testResult.error}</div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 mb-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {(testResult.duration_ms / 1000).toFixed(1)}s
                    </span>
                    {testResult.tokens && (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {testResult.tokens.input + testResult.tokens.output} tokens
                        <span className="text-slate-400">
                          ({testResult.tokens.input}in / {testResult.tokens.output}out)
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
                    <pre className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono leading-relaxed">
                      {testResult.output}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}

          {!testing && !testResult && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-300 dark:text-slate-600">
                <Play className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <div className="text-sm">点击「测试」查看输出</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────

export default function ContentTypeConfigPage() {
  const [types, setTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [config, setConfig] = useState<PipelineConfig | null>(null)
  const [selectedNode, setSelectedNode] = useState<NodeKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string>('')
  const [configSource, setConfigSource] = useState<string>('')
  const [testModel, setTestModel] = useState('claude-sonnet')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({})

  const loadTypes = useCallback(async () => {
    const data = await fetchContentTypes()
    setTypes(data)
  }, [])

  useEffect(() => { loadTypes() }, [loadTypes])

  const loadConfig = useCallback(async (type: string) => {
    setLoading(true)
    setMessage(null)
    setSelectedNode(null)
    setEditingPrompts({})
    setTestResults({})
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
    loadConfig(type)
  }

  const getNodePrompt = (nodeKey: NodeKey): string => {
    if (editingPrompts[nodeKey] !== undefined) return editingPrompts[nodeKey]
    if (!config) return ''
    const node = PIPELINE_NODES.find(n => n.key === nodeKey)
    if (!node) return ''
    return getNestedValue(config as Record<string, unknown>, node.promptField)
  }

  const setNodePrompt = (nodeKey: NodeKey, value: string) => {
    setEditingPrompts(prev => ({ ...prev, [nodeKey]: value }))
  }

  const handleSaveNode = async () => {
    if (!selectedType || !config || !selectedNode) return
    setSaving(true)
    setMessage(null)

    const node = PIPELINE_NODES.find(n => n.key === selectedNode)
    if (!node) { setSaving(false); return }

    const prompt = getNodePrompt(selectedNode)
    const updatedConfig = setNestedValue(config as Record<string, unknown>, node.promptField, prompt)
    setConfig(updatedConfig)

    const ok = await saveTypeConfig(selectedType, updatedConfig)
    if (ok) {
      setMessage({ type: 'success', text: `${node.label} 的配置已保存` })
      setConfigUpdatedAt(new Date().toISOString())
    } else {
      setMessage({ type: 'error', text: '保存失败' })
    }
    setSaving(false)
  }

  const handleTest = async () => {
    if (!selectedNode) return
    setTesting(true)

    const node = PIPELINE_NODES.find(n => n.key === selectedNode)
    if (!node) { setTesting(false); return }

    const prompt = getNodePrompt(selectedNode)
    const result = await testStep({
      step: selectedNode,
      prompt,
      model: testModel,
      input: { keyword: '示例关键词' },
    })

    setTestResults(prev => ({ ...prev, [selectedNode]: result }))
    setTesting(false)
  }

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

  const currentNode = selectedNode
    ? PIPELINE_NODES.find(n => n.key === selectedNode) || null
    : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      {/* 顶栏 */}
      <div className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              内容流水线配置
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
        <div className="max-w-[1440px] mx-auto px-6 pt-4">
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
      <div className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="flex gap-6" style={{ minHeight: 'calc(100vh - 160px)' }}>
          {/* 左侧 - 内容类型列表 */}
          <div className="w-56 flex-shrink-0">
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
                    <span className="text-xs">点击右上角初始化</span>
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

          {/* 右侧 - 流水线 + 节点编辑器 */}
          <div className="flex-1 min-w-0">
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
              <div>
                {/* 类型标题 + 元信息 */}
                <div className="flex items-center justify-between mb-4">
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
                </div>

                {/* 流水线节点可视化 */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                  <PipelineVisualizer
                    selectedNode={selectedNode}
                    onSelectNode={setSelectedNode}
                  />
                </div>

                {/* 节点详情面板 */}
                {currentNode && (
                  <NodeDetailPanel
                    node={currentNode}
                    prompt={getNodePrompt(selectedNode!)}
                    onPromptChange={v => setNodePrompt(selectedNode!, v)}
                    model={testModel}
                    onModelChange={setTestModel}
                    onTest={handleTest}
                    onSave={handleSaveNode}
                    testResult={testResults[selectedNode!] || null}
                    testing={testing}
                    saving={saving}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
