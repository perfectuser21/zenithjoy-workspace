/**
 * wechat-draft-reasoning-r2.test.ts — 第二刀合同测试（实化 mock 存根）
 * BEHAVIOR-5: generateChatDraft 返回 {reply, tags, reasoning} 三字段
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock openrouter 模块（避免真实 LLM 调用）
vi.mock('../../../apps/api/src/lib/openrouter', () => ({
  chat: vi.fn()
}))

import { generateChatDraft } from '../../../apps/api/src/services/wechat-draft'
import { chat } from '../../../apps/api/src/lib/openrouter'

const mockChat = vi.mocked(chat)

describe('BEHAVIOR-5: generateChatDraft reasoning 真实现', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('LLM 返回 reasoning → 响应体含 reasoning，≤30 字', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({ reply: '你好', tags: { stage: 'A1' }, reasoning: '处于初次接触阶段' })
    )
    const result = await generateChatDraft({ contact: '张三', history: [] })
    expect(result).toHaveProperty('reasoning')
    expect(result.reasoning!.length).toBeLessThanOrEqual(30)
  })

  it('PII 命中 → reasoning 替换为降级文案', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({ reply: '收到', tags: { stage: 'A2' }, reasoning: '客户手机13800138000意向高' })
    )
    const result = await generateChatDraft({ contact: '李四', history: [] })
    expect(result.reasoning).not.toContain('13800138000')
  })

  it('LLM 返回非 JSON(:548 兜底) → reasoning 缺省', async () => {
    mockChat.mockResolvedValueOnce('抱歉，我现在无法回答。')
    const result = await generateChatDraft({ contact: '王五', history: [] })
    expect(result.reasoning).toBeUndefined()
  })

  it('tags.stage 必须在 A1-A4 范围内', async () => {
    mockChat.mockResolvedValueOnce(
      JSON.stringify({ reply: '好的', tags: { stage: 'A3' }, reasoning: '高意向待跟进' })
    )
    const result = await generateChatDraft({ contact: '赵六', history: [] })
    expect(['A1','A2','A3','A4']).toContain(result.tags?.stage)
  })
})
