/**
 * wechat-draft-reasoning-r2.test.ts — 第二刀合同测试（实化第一刀 mock 存根）
 * BEHAVIOR-5: generateChatDraft 返回 {reply, tags, reasoning} 三字段
 *
 * mock 层级：真实代码路径 services/wechat-draft.ts → llm/openrouter.callOpenRouter，
 * 在 llm/openrouter 模块边界 mock（返回 { content }），generateChatDraft 全链真跑
 *（含 extractJsonFromContent / filterPiiReasoning / sanitizeReply / DB gating）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../apps/api/src/llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}))

import { generateChatDraft } from '../../../apps/api/src/services/wechat-draft'
import { callOpenRouter } from '../../../apps/api/src/llm/openrouter'

const mockLLM = vi.mocked(callOpenRouter)

const BASE_PARAMS = {
  sender: '张三',
  wechat_id: 'wx_r2_reasoning_test',
  content: '你们这个多少钱',
  mode: 'auto' as const,
}

function llmReturns(payload: unknown): void {
  mockLLM.mockResolvedValue({ content: typeof payload === 'string' ? payload : JSON.stringify(payload) } as never)
}

describe('BEHAVIOR-5: generateChatDraft reasoning 真实现', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('LLM 返回 reasoning → 响应体含 reasoning，≤30 字', async () => {
    llmReturns({ reply: '你好，这边价格可以聊', tags: { stage: 'A1', escalate: false }, reasoning: '初次询价，处于接触阶段' })
    const result = await generateChatDraft({ ...BASE_PARAMS })
    expect(result.status).toBe('sent')
    expect(result.reasoning).toBeDefined()
    expect(result.reasoning!.length).toBeLessThanOrEqual(30)
  })

  it('PII 命中 → reasoning 不透传（undefined，绝不含手机号）', async () => {
    llmReturns({ reply: '收到', tags: { stage: 'A2', escalate: false }, reasoning: '客户手机13800138000意向高' })
    const result = await generateChatDraft({ ...BASE_PARAMS })
    expect(result.status).toBe('sent')
    expect(result.reasoning ?? '').not.toContain('13800138000')
    expect(result.reasoning).toBeUndefined()
  })

  it('LLM 返回非 JSON（正则兜底路径）→ reasoning 缺省不崩', async () => {
    llmReturns('抱歉，这个问题我需要确认一下再答复你。')
    const result = await generateChatDraft({ ...BASE_PARAMS })
    expect(result.reasoning).toBeUndefined()
  })

  it('旧 LLM 无 reasoning 字段（向后兼容）→ 不崩且 reasoning 缺省', async () => {
    llmReturns({ reply: '好的，稍等', tags: { stage: 'A3', escalate: false } })
    const result = await generateChatDraft({ ...BASE_PARAMS })
    expect(result.status).toBe('sent')
    expect(result.reasoning).toBeUndefined()
  })

  it('reasoning 超 30 字 → 截断到 ≤30 字', async () => {
    llmReturns({ reply: '好的', tags: { stage: 'A2', escalate: false }, reasoning: '这是一段超过三十个字符的超长推理摘要文本用来验证中台侧截断逻辑是否生效' })
    const result = await generateChatDraft({ ...BASE_PARAMS })
    expect(result.status).toBe('sent')
    expect((result.reasoning ?? '').length).toBeLessThanOrEqual(30)
  })
})
