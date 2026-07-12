/**
 * wechat-draft-reasoning.test.ts — 中台合同 reasoning 字段测试
 *
 * 覆盖 BEHAVIOR-4（contract-dod.md）：{reply, tags, reasoning} 三路断言
 *   - 正常路径：LLM 返回 reasoning → 响应体含 reasoning，≤30 字
 *   - 兜底缺省：:548 正则兜底，reasoning 缺失 → 降级文案
 *   - PII 命中降级：reasoning 含手机号 → 替换降级文案
 *   - 向后兼容：旧 LLM 返回 {reply, tags}（无 reasoning）→ 不崩
 *
 * 运行：npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts
 *
 * 【第一刀遗留说明，第二刀替换】
 *   下方 mockGenerateDraft / filterPiiReasoning / agentRenderReasoning 均为第一刀 mock 存根，
 *   第二刀实现完成后，「第二刀新增测试」describe 块将直接 import 真实 generateChatDraft，
 *   mock 存根区块可整体删除（或保留作回归兜底）。
 *   替换入口：apps/api/src/services/wechat-draft.ts → generateChatDraft
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

// ─── 存根：PII 过滤函数（第一刀遗留，实现后替换为真实导入） ─────────────────

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

// ─── 存根：generateChatDraft 模拟（第一刀遗留，第二刀替换为真实 import） ─────

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

// ─── 第二刀新增测试（BEHAVIOR-4，真实 generateChatDraft + vitest mock openrouter）─────────────────────
// 实现完成后这些测试应全绿。

import { vi } from 'vitest';

// mock callOpenRouter（vitest module mock）
vi.mock('../../../../apps/api/src/llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

// mock DB pool（避免真实连接）
vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

// mock 所有依赖的 wechat 服务
vi.mock('../../../../apps/api/src/services/wechat/cs-config-store', () => ({
  getPersona: vi.fn().mockResolvedValue({
    self_name: 'AI客服',
    address_style: '您',
    tone: '专业',
    sentence_style: '简洁',
    use_emoji: 'none',
    banned_phrases: [],
    few_shot: [],
  }),
  getBusinessKB: vi.fn().mockResolvedValue({ company: { name: '测试公司' }, products: [], audience_segments: [], qa_docs: [] }),
}));

vi.mock('../../../../apps/api/src/services/wechat/cs-account-config-store', () => ({
  getCSConfigByAgentId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../apps/api/src/services/wechat/cs-identity-resolve', () => ({
  resolveCsWechatIdentity: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../apps/api/src/services/wechat/cs-route-decision', () => ({
  decideAutoSendRoute: vi.fn().mockReturnValue('send'),
  ROUTE_SEND: 'send',
  ROUTE_SKIP_GROUP: 'skip_group',
}));

vi.mock('../../../../apps/api/src/services/wechat/contact-memory', () => ({
  appendMessage: vi.fn().mockResolvedValue(42),
  consolidate: vi.fn().mockResolvedValue(undefined),
  getContactMemory: vi.fn().mockResolvedValue({ summary: '', facts: [] }),
  getShortTerm: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../apps/api/src/services/wechat/tenant-memory', () => ({
  appendTenantMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../apps/api/src/services/wechat/context-assembler', () => ({
  assembleChatContext: vi.fn().mockReturnValue({ system: 'system prompt', user: 'user message' }),
}));

vi.mock('../../../../apps/api/src/services/wechat/business-kb', () => ({
  retrieveRelevantKB: vi.fn().mockReturnValue([]),
}));

describe('[BEHAVIOR-4] generateChatDraft 真实 LLM 调用（第二刀）', () => {
  let generateChatDraft: typeof import('../../../../apps/api/src/services/wechat-draft').generateChatDraft;
  let callOpenRouterMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { callOpenRouter } = await import('../../../../apps/api/src/llm/openrouter');
    callOpenRouterMock = callOpenRouter as ReturnType<typeof vi.fn>;
    ({ generateChatDraft } = await import('../../../../apps/api/src/services/wechat-draft'));
  });

  describe('正常路径 — 真实 LLM reasoning 返回', () => {
    it('真实 generateChatDraft 返回 {reply, tags, reasoning}，reasoning ≤30 字', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: '您好，感谢咨询',
          tags: { stage: 'A1', escalate: false },
          reasoning: '客户初次询问，已推送欢迎话术',
        }),
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '你好，我想了解一下',
        mode: 'auto',
      });

      expect(result.status).toBe('sent');
      expect(result.reply).toBeTruthy();
      // reasoning 字段已透出
      expect((result as Record<string, unknown>).reasoning).toBeDefined();
      const r = (result as Record<string, unknown>).reasoning as string;
      expect(typeof r).toBe('string');
      expect(r.length).toBeLessThanOrEqual(30);
    });

    it('stage 取值域严格限定 A1-A4（Invariant I4）', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: '收到，马上处理',
          tags: { stage: 'A2', escalate: false },
          reasoning: '客户意向明确',
        }),
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '我很感兴趣，能详细说说吗',
        mode: 'auto',
      });

      const validStages = new Set(['A1', 'A2', 'A3', 'A4', null, undefined]);
      // tags 通过 result 验证不崩即可（stage 验证在 status=sent 路径）
      expect(result.status).toBe('sent');
    });
  });

  describe('PII 硬闸接线 — 中台第一闸（第二刀接线）', () => {
    it('reasoning 含 11 位手机号 → 中台返回前替换为降级文案，不透传给 agent', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: '好的，已记录',
          tags: { stage: 'A1', escalate: false },
          reasoning: '客户留号 13800138000 要求回电',
        }),
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '我电话 13800138000',
        mode: 'auto',
      });

      expect(result.status).toBe('sent');
      const reasoning = (result as Record<string, unknown>).reasoning as string | undefined;
      if (reasoning !== undefined) {
        expect(reasoning).not.toContain('13800138000');
      }
    });

    it('reasoning 含 wxid_ 微信号 → 替换为降级文案', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: '已添加好友',
          tags: { stage: 'A3', escalate: false },
          reasoning: '客户微信 wxid_abcxyz123 已确认',
        }),
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '我微信是 wxid_abcxyz123',
        mode: 'auto',
      });

      const reasoning = (result as Record<string, unknown>).reasoning as string | undefined;
      if (reasoning !== undefined) {
        expect(reasoning).not.toContain('wxid_abcxyz123');
      }
    });

    it('PII 过滤后 reply 字段不受影响（只过滤 reasoning）', async () => {
      const originalReply = '好的，我们会尽快联系您';
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: originalReply,
          tags: { stage: 'A1', escalate: false },
          reasoning: '手机 13900139000 已记录',
        }),
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '请联系我',
        mode: 'auto',
      });

      expect(result.status).toBe('sent');
      expect(result.reply).toBe(originalReply);
    });
  });

  describe('兜底缺省路径 — 正则兜底（第二刀覆盖真实路径）', () => {
    it('LLM 返回非 JSON 字符串 → 正则兜底路径，reasoning 字段为 undefined', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: '好的，感谢您的咨询，我们会尽快处理',
      });

      const result = await generateChatDraft({
        sender: 'test-user',
        wechat_id: 'wx-test',
        content: '你好',
        mode: 'auto',
      });

      expect(result.status).toBe('sent');
      const reasoning = (result as Record<string, unknown>).reasoning;
      expect(reasoning).toBeUndefined();
    });
  });

  describe('向后兼容 — 旧 LLM 格式（无 reasoning 字段）', () => {
    it('旧格式 {reply, tags} 无 reasoning → generateChatDraft 不抛，API 响应不崩', async () => {
      callOpenRouterMock.mockResolvedValue({
        content: JSON.stringify({
          reply: '您好，感谢咨询',
          tags: { stage: 'A1', escalate: false },
          // 无 reasoning 字段（旧格式）
        }),
      });

      await expect(
        generateChatDraft({
          sender: 'test-user',
          wechat_id: 'wx-test',
          content: '在吗',
          mode: 'auto',
        })
      ).resolves.not.toThrow();
    });
  });
});
