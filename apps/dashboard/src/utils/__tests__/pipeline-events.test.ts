import { describe, it, expect } from 'vitest'
import { formatEventNode, formatDurationMs } from '../pipeline-events'

describe('formatEventNode', () => {
  it('research: 提取 findings 路径尾', () => {
    const r = formatEventNode({ node: 'research', findings_path: '/home/cecelia/content-output/foo/findings.json' })
    expect(r.icon).toBe('🔬')
    expect(r.label).toBe('调研')
    expect(r.detail).toBe('→ foo/findings.json')
    expect(r.accent).toBe('neutral')
  })

  it('copywrite: 显示 copy 路径尾', () => {
    const r = formatEventNode({ node: 'copywrite', copy_path: '/home/cecelia/content-output/foo/cards/copy.md' })
    expect(r.label).toBe('文案生成')
    expect(r.detail).toBe('→ cards/copy.md')
    expect(r.accent).toBe('neutral')
  })

  it('copy_review APPROVED: 绿色通过', () => {
    const r = formatEventNode({ node: 'copy_review', copy_review_round: 1, copy_review_verdict: 'APPROVED' })
    expect(r.icon).toBe('✅')
    expect(r.label).toBe('文案审核 · 第 1 轮')
    expect(r.detail).toBe('APPROVED')
    expect(r.accent).toBe('ok')
  })

  it('copy_review REVISION: 红色需重写', () => {
    const r = formatEventNode({ node: 'copy_review', copy_review_round: 2, copy_review_verdict: 'REVISION' })
    expect(r.icon).toBe('❌')
    expect(r.label).toBe('文案审核 · 第 2 轮')
    expect(r.detail).toBe('REVISION（需重写）')
    expect(r.accent).toBe('bad')
  })

  it('image_review PASS: 绿色', () => {
    const r = formatEventNode({ node: 'image_review', image_review_round: 3, image_review_verdict: 'PASS' })
    expect(r.icon).toBe('✅')
    expect(r.label).toBe('图片审核 · 第 3 轮')
    expect(r.accent).toBe('ok')
  })

  it('image_review FAIL: 红色重生', () => {
    const r = formatEventNode({ node: 'image_review', image_review_round: 1, image_review_verdict: 'FAIL' })
    expect(r.icon).toBe('❌')
    expect(r.detail).toBe('FAIL（图片重生）')
    expect(r.accent).toBe('bad')
  })

  it('export: NAS URL 完整显示', () => {
    const r = formatEventNode({ node: 'export', nas_url: '/volume1/workspace/vault/zenithjoy-creator/content/abc' })
    expect(r.icon).toBe('📦')
    expect(r.detail).toBe('NAS: /volume1/workspace/vault/zenithjoy-creator/content/abc')
    expect(r.accent).toBe('ok')
  })

  it('generate: cards_dir 加 / 后缀', () => {
    const r = formatEventNode({ node: 'generate', cards_dir: '/home/cecelia/content-output/foo/cards' })
    expect(r.detail).toBe('→ foo/cards/')
  })

  it('unknown node: 降级显示', () => {
    const r = formatEventNode({ node: 'mystery' })
    expect(r.icon).toBe('•')
    expect(r.label).toBe('mystery')
    expect(r.accent).toBe('neutral')
  })

  it('缺 round 时用占位符 "?"', () => {
    const r = formatEventNode({ node: 'copy_review', copy_review_verdict: 'REVISION' })
    expect(r.label).toBe('文案审核 · 第 ? 轮')
  })
})

describe('formatDurationMs', () => {
  it('<1s 用 ms', () => {
    expect(formatDurationMs(500)).toBe('500ms')
    expect(formatDurationMs(999)).toBe('999ms')
  })

  it('1s~1min 用 s 一位小数', () => {
    expect(formatDurationMs(1000)).toBe('1.0s')
    expect(formatDurationMs(12500)).toBe('12.5s')
    expect(formatDurationMs(59999)).toBe('60.0s')
  })

  it('>=1min 用 MmSs', () => {
    expect(formatDurationMs(60000)).toBe('1m0s')
    expect(formatDurationMs(125000)).toBe('2m5s')
    expect(formatDurationMs(3600000)).toBe('60m0s')
  })
})
