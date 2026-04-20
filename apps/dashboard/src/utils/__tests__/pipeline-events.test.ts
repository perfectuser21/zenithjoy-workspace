import { describe, it, expect } from 'vitest'
import { formatEventNode, formatDurationMs, type EventPayload } from '../pipeline-events'

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

describe('EventPayload — WF-3 观察性字段', () => {
  it('类型接受新增 meta 字段 (prompt_sent / raw_stdout / raw_stderr / exit_code / duration_ms / container_id)', () => {
    // 用运行时 assertion 代替 expectTypeOf（vitest 配置简单稳），确保 TS 编译通过 = 类型正确
    const p: EventPayload = {
      node: 'research',
      step_index: 1,
      prompt_sent: 'Hello',
      raw_stdout: 'some stdout',
      raw_stderr: 'some stderr',
      exit_code: 0,
      duration_ms: 12345,
      container_id: 'abc123def456',
    }
    expect(p.prompt_sent).toBe('Hello')
    expect(p.raw_stdout).toBe('some stdout')
    expect(p.raw_stderr).toBe('some stderr')
    expect(p.exit_code).toBe(0)
    expect(p.duration_ms).toBe(12345)
    expect(p.container_id).toBe('abc123def456')
  })

  it('meta 字段全部 optional（不传也合法；旧事件兼容）', () => {
    const p: EventPayload = { node: 'research', step_index: 1 }
    expect(p.prompt_sent).toBeUndefined()
    expect(p.raw_stdout).toBeUndefined()
    expect(p.container_id).toBeUndefined()
  })

  it('exit_code 允许 null（spawn 失败场景）', () => {
    const p: EventPayload = {
      node: 'research',
      step_index: 1,
      exit_code: null,
      container_id: null,
    }
    expect(p.exit_code).toBeNull()
    expect(p.container_id).toBeNull()
  })

  it('formatEventNode 对带 meta 的 event 不崩溃、不干扰 icon/label/detail', () => {
    const r = formatEventNode({
      node: 'research',
      findings_path: '/home/cecelia/content-output/foo/findings.json',
      prompt_sent: 'x'.repeat(8000),
      raw_stdout: 'stdout' + '\n'.repeat(500),
      exit_code: 0,
      duration_ms: 99999,
      container_id: 'abcdef012345',
    })
    // 原 display 逻辑只消费业务字段，meta 不影响
    expect(r.icon).toBe('🔬')
    expect(r.label).toBe('调研')
    expect(r.detail).toBe('→ foo/findings.json')
  })
})
