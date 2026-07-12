/**
 * wechat-draft-reasoning.test.ts — 中台合同 reasoning 字段骨架测试
 *
 * 覆盖 BEHAVIOR-4：{reply, tags, reasoning} 三路断言
 *   - 正常路径：LLM 返回 reasoning → 响应体含 reasoning，≤30 字
 *   - 兜底缺省：:548 正则兜底，reasoning 缺失 → 降级文案
 *   - PII 命中降级：reasoning 含手机号 → 替换降级文案
 *   - 向后兼容：旧 LLM 返回 {reply, tags}（无 reasoning）→ 不崩
 *
 * 运行：npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts
 *
 * TODO: 实现完成后替换 mock 为真实 generateChatDraft 调用
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── 存根：中台合同扩展后的响应类型 ───────────────────────────────────────────

interface DraftResponse {
  status: 'sent' | 'ai_failed' | 'skipped' | 'monitor';
  reply?: string;
  reasoning?: string;
  tags?: Record<string, unknown>;
  message_id?: string;
}

// ─── 存根：PII 过滤函数（实现后替换为真实导入） ───────────────────────────────

function filterPiiReasoning(reasoning: string): string {
  const phonePattern = /1[3-9]\d{9}/g;
  const wechatPattern = /wxid_[A-Za-z0-9_]+/g;
  const idCardPattern = /\d{17}[\dXx]/g;
  let result = reasoning;
  if (phonePattern.test(result)) return '[已过滤]';
  if (wechatPattern.test(result)) return '[已过滤]';
  if (idCardPattern.test(result)) return '[已过滤]';
  return result;
}

// ─── 存根：generateChatDraft 模拟（实现后替换） ──────────────────────────────

async function mockGenerateDraft(opts: {
  llmReasoning?: string;
  llmReply?: string;
  llmTags?: Record<string, unknown>;
  simulateFallback?: boolean;
  contact?: string;
}): Promise<DraftResponse> {
  const { llmReasoning, llmReply = '您好，感谢您的咨询', llmTags = { stage: 'A1', escalate: false } } = opts;

  if (opts.simulateFallback) {
    // :548 正则兜底路径 — LLM 返回非 JSON，reasoning 缺省
    return {
      status: 'sent',
      reply: llmReply,
      tags: llmTags,
      reasoning: undefined,  // 兜底路径 reasoning 缺省
    };
  }

  // 正常路径：LLM 返回 {reply, tags, reasoning}
  const rawReasoning = llmReasoning ?? '客户询问价格，已推送活动方案';
  const filteredReasoning = filterPiiReasoning(rawReasoning);
  const truncatedReasoning = filteredReasoning.slice(0, 30);

  return {
    status: 'sent',
    reply: llmReply,
    tags: llmTags,
    reasoning: truncatedReasoning,
  };
}

function agentRenderReasoning(response: DraftResponse, contact: string): string {
  if (!response.reasoning) {
    return `已回复 ${contact}`;
  }
  return response.reasoning;
}

// ─── BEHAVIOR-4 测试 ─────────────────────────────────────────────────────────

describe('wechat-draft reasoning 三路断言 [BEHAVIOR-4]', () => {

  describe('正常路径 — reasoning normal path', () => {
    it('LLM 返回 reasoning → 响应体含 reasoning，长度 ≤30 字', async () => {
      const response = await mockGenerateDraft({
        llmReasoning: '客户询问价格，已推送节日优惠活动方案',
      });

      expect(response.status).toBe('sent');
      expect(response.reasoning).toBeDefined();
      expect(typeof response.reasoning).toBe('string');
      expect(response.reasoning!.length).toBeLessThanOrEqual(30);
    });

    it('响应体同时含 reply + tags + reasoning（三字段联合断言）', async () => {
      const response = await mockGenerateDraft({
        llmReasoning: '已回复产品咨询',
        llmReply: '您好，感谢您的咨询！',
        llmTags: { stage: 'A2', escalate: false },
      });

      expect(response.reply).toBeTruthy();
      expect(response.tags).toBeDefined();
      expect(response.reasoning).toBeTruthy();
    });

    it('stage 取值域限定 A1-A4（Invariant I4）', async () => {
      const validStages = new Set(['A1', 'A2', 'A3', 'A4', null]);
      const response = await mockGenerateDraft({ llmReasoning: '已处理' });
      const stage = response.tags?.stage;
      expect(validStages.has(stage as string | null)).toBe(true);
    });
  });

  describe('兜底缺省路径 — reasoning fallback', () => {
    it(':548 正则兜底，reasoning 缺省 → agent 渲染降级文案「已回复 {联系人}」', async () => {
      const contact = '张三';
      const response = await mockGenerateDraft({
        simulateFallback: true,
        contact,
      });

      expect(response.status).toBe('sent');
      expect(response.reasoning).toBeUndefined();

      // agent 侧渲染降级文案
      const rendered = agentRenderReasoning(response, contact);
      expect(rendered).toBe(`已回复 ${contact}`);
    });
  });

  describe('PII 命中降级 — reasoning PII degraded', () => {
    it('reasoning 含手机号 → 被替换为降级文案', async () => {
      const response = await mockGenerateDraft({
        llmReasoning: '客户说他手机 13800138000 可以联系',
      });

      expect(response.reasoning).not.toContain('13800138000');
    });

    it('reasoning 含微信号 → 被替换', async () => {
      const response = await mockGenerateDraft({
        llmReasoning: '客户微信 wxid_abcxyz123 已添加',
      });

      expect(response.reasoning).not.toContain('wxid_abcxyz123');
    });

    it('复述客户原话含手机号 → PII 过滤（BEHAVIOR-3 对应 vitest 侧）', async () => {
      const response = await mockGenerateDraft({
        llmReasoning: '客户询问并留下手机 13912345678，已推送方案',
      });

      expect(response.reasoning).not.toContain('13912345678');
      expect(response.status).toBe('sent');
    });
  });

  describe('向后兼容 — reasoning backward compat', () => {
    it('旧 LLM 返回 {reply, tags}（无 reasoning）→ 不崩，agent 侧渲染降级文案', async () => {
      // 模拟旧格式：无 reasoning 字段
      const oldResponse: DraftResponse = {
        status: 'sent',
        reply: '您好！',
        tags: { stage: 'A1', escalate: false },
        // reasoning 字段不存在
      };

      // agent 侧不应抛异常
      expect(() => agentRenderReasoning(oldResponse, '李四')).not.toThrow();
      const rendered = agentRenderReasoning(oldResponse, '李四');
      expect(rendered).toBe('已回复 李四');
    });

    it('reasoning 为空字符串时 → agent 渲染降级文案', async () => {
      const response: DraftResponse = {
        status: 'sent',
        reply: '您好！',
        tags: {},
        reasoning: '',
      };

      const rendered = agentRenderReasoning(response, '王五');
      // 空字符串视为缺省，渲染降级文案
      expect(rendered).toBe('已回复 王五');
    });
  });

});
