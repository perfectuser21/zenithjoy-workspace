export interface EventPayload {
  node: string
  step_index?: number
  error?: string | null
  findings_path?: string
  copy_path?: string
  cards_dir?: string
  manifest_path?: string
  nas_url?: string
  copy_review_verdict?: 'APPROVED' | 'REVISION'
  copy_review_round?: number
  image_review_verdict?: 'PASS' | 'FAIL'
  image_review_round?: number
  [k: string]: unknown
}

export interface PipelineEvent {
  id: number
  created_at: string
  payload: EventPayload
}

export interface EventDisplay {
  icon: string
  label: string
  detail: string
  accent: 'ok' | 'bad' | 'neutral'
}

const fileTail = (path?: string) => (path ? path.split('/').slice(-2).join('/') : '')

export function formatEventNode(p: EventPayload): EventDisplay {
  switch (p.node) {
    case 'research':
      return {
        icon: '🔬',
        label: '调研',
        detail: p.findings_path ? `→ ${fileTail(p.findings_path)}` : '',
        accent: 'neutral',
      }
    case 'copywrite':
      return {
        icon: '✍️',
        label: '文案生成',
        detail: p.copy_path ? `→ ${fileTail(p.copy_path)}` : '',
        accent: 'neutral',
      }
    case 'copy_review': {
      const ok = p.copy_review_verdict === 'APPROVED'
      return {
        icon: ok ? '✅' : '❌',
        label: `文案审核 · 第 ${p.copy_review_round ?? '?'} 轮`,
        detail: ok ? 'APPROVED' : 'REVISION（需重写）',
        accent: ok ? 'ok' : 'bad',
      }
    }
    case 'generate':
      return {
        icon: '🎨',
        label: '图片生成',
        detail: p.cards_dir ? `→ ${fileTail(p.cards_dir)}/` : '',
        accent: 'neutral',
      }
    case 'image_review': {
      const ok = p.image_review_verdict === 'PASS'
      return {
        icon: ok ? '✅' : '❌',
        label: `图片审核 · 第 ${p.image_review_round ?? '?'} 轮`,
        detail: ok ? 'PASS' : 'FAIL（图片重生）',
        accent: ok ? 'ok' : 'bad',
      }
    }
    case 'export':
      return {
        icon: '📦',
        label: '导出',
        detail: p.nas_url ? `NAS: ${p.nas_url}` : '',
        accent: 'ok',
      }
    default:
      return { icon: '•', label: p.node || '未知', detail: '', accent: 'neutral' }
  }
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`
}
