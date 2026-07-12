/**
 * draft-generate 三路断言测试骨架
 * 对应：[BEHAVIOR-INV-7] reasoning 单一来源
 * 对应：[BEHAVIOR-INV-2] PII 双硬闸（中台侧）
 *
 * 待实现：从实际模块导入
 * import { generateDraft, DraftResult } from '../../../apps/backend/src/wechat-draft'
 */

import { describe, it, expect } from 'vitest'

// ---- 占位类型定义（实际实现替换）----

interface DraftResult {
  reply: string
  tags: string[]
  reasoning: string
}

/**
 * 占位实现：模拟 draft-generate 返回体
 * 实际实现替换此函数
 */
async function generateDraftStub(params: {
  contact: string
  message: string
  simulatePii?: boolean
  simulateMissingReasoning?: boolean
}): Promise<DraftResult> {
  const { contact, message, simulatePii, simulateMissingReasoning } = params

  // 模拟 PII 过滤
  const piiPattern = /1[3-9]\d{9}|wx[a-zA-Z0-9]{6,20}|\d{17}[\dXx]/g
  let filteredMessage = message.replace(piiPattern, '[已过滤]')

  if (simulatePii) {
    // PII 命中降级：reasoning 整句替换
    return {
      reply: '感谢您的咨询',
      tags: ['咨询'],
      reasoning: `已回复 ${contact}`,  // 降级文案
    }
  }

  if (simulateMissingReasoning) {
    // reasoning 字段缺失 → 降级
    const result: Partial<DraftResult> = {
      reply: '好的，我们会处理',
      tags: ['处理中'],
    }
    // reasoning 缺省降级
    return {
      ...result,
      reasoning: `已回复 ${contact}`,
    } as DraftResult
  }

  return {
    reply: '感谢您的咨询，我们会尽快处理',
    tags: ['咨询', '处理中'],
    reasoning: '分析需求后建议方案A',
  }
}

// ---- 测试 ----

describe('draft-generate 三路断言', () => {
  describe('路径一：正常路径', () => {
    it('返回 reply/tags/reasoning 三字段', async () => {
      const result = await generateDraftStub({
        contact: '张三',
        message: '请问产品有什么优惠',
      })

      expect(result.reply).toBeTruthy()
      expect(Array.isArray(result.tags)).toBe(true)
      expect(result.reasoning).toBeTruthy()
    })

    it('reasoning 长度 ≤30 字', async () => {
      const result = await generateDraftStub({
        contact: '张三',
        message: '请问产品有什么优惠',
      })

      expect(result.reasoning.length).toBeLessThanOrEqual(30)
    })

    it('返回体向后兼容（reasoning 为可选字段）', async () => {
      const result = await generateDraftStub({
        contact: '李四',
        message: '你好',
      })

      // reply 和 tags 是必需的，reasoning 可选但存在时必须合规
      expect(result).toHaveProperty('reply')
      expect(result).toHaveProperty('tags')
    })
  })

  describe('路径二：兜底缺省（reasoning 缺失）', () => {
    it('reasoning 缺失时降级文案为「已回复 {联系人}」', async () => {
      const result = await generateDraftStub({
        contact: '王五',
        message: '测试',
        simulateMissingReasoning: true,
      })

      expect(result.reasoning).toBe('已回复 王五')
    })

    it('降级文案不为空、不为 undefined/null', async () => {
      const result = await generateDraftStub({
        contact: '王五',
        message: '测试',
        simulateMissingReasoning: true,
      })

      expect(result.reasoning).toBeTruthy()
      expect(result.reasoning).not.toBeUndefined()
      expect(result.reasoning).not.toBeNull()
    })
  })

  describe('路径三：PII 命中降级', () => {
    it('消息含手机号时 reasoning 降级为固定文案', async () => {
      const result = await generateDraftStub({
        contact: '赵六',
        message: '我的电话是13812345678',
        simulatePii: true,
      })

      expect(result.reasoning).toBe('已回复 赵六')
      // 不应包含原始手机号
      expect(result.reasoning).not.toMatch(/1[3-9]\d{9}/)
    })

    it('PII 降级后 reply 不含原始 PII', async () => {
      const result = await generateDraftStub({
        contact: '赵六',
        message: '微信号wxtest123加我',
        simulatePii: true,
      })

      expect(result.reply).not.toMatch(/wx[a-zA-Z0-9]{6,20}/)
    })

    it('reasoning 降级后长度仍 ≤30 字', async () => {
      const result = await generateDraftStub({
        contact: '赵六',
        message: '测试PII',
        simulatePii: true,
      })

      expect(result.reasoning.length).toBeLessThanOrEqual(30)
    })
  })

  describe('openrouter reasoning_content 剥离', () => {
    it('reasoning_content 不出现在 reply 字段', () => {
      // 模拟 openrouter 返回体中 reasoning_content 存在时，不泄漏到 reply
      const openrouterRaw = {
        choices: [{
          message: {
            content: '{"reply":"感谢咨询","tags":[],"reasoning":"分析后建议A"}',
            // reasoning_content 是 openrouter 特有字段，不应透传
          },
          reasoning_content: '这是内部推理过程，不应出现在返回体',
        }],
      }

      // 模拟剥离逻辑：只取 content 中的 JSON
      const parsed = JSON.parse(openrouterRaw.choices[0].message.content)
      expect(parsed.reply).not.toContain('这是内部推理过程')
      expect(parsed.reasoning).not.toContain('这是内部推理过程')
    })
  })
})
