/* eslint-disable @typescript-eslint/no-explicit-any -- 注入 mock deps，测试容忍 any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callOpenRouter } from '../../llm/openrouter';

/**
 * sanitizeReply 技术身份自述句兜底行为测试（走 generateChatDraft 公开路径）。
 *
 * 背景：客户粘贴命令/报错进记忆后，AI 偶尔自述"我会查日志/执行命令/技术排查"。
 * sanitizeReply 追加自述句清洗：命中「我会/可以/能…(命令/日志/脚本/排查/后台)」的整句剔除，
 * 但不误伤不含这些关键词的普通句（如"我会尽快帮您反馈"）。
 *
 * mock 对齐 wechat-draft-auto-reply.test.ts：pool（可控 query）+ openrouter。
 */

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../db/connection', () => ({
  default: { query: mockQuery },
}));

vi.mock('../../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

describe('sanitizeReply 技术身份自述句清洗 [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    process.env.NODE_ENV = 'test';
  });

  it('剔除自述技术能力的整句，保留正常句子（不误伤"我会尽快帮您反馈"）', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue({
      content: '我会查日志和执行命令，帮你排查。我会尽快帮您反馈。',
    } as any);
    const mod = await import('../wechat-draft');
    const result: any = await mod.generateChatDraft({
      sender: '于瑾',
      wechat_id: 'wxid_yujin',
      content: '报错了',
      mode: 'auto',
    } as any);

    expect(result.status).toBe('sent');
    // 自述技术能力的句子被剔除
    expect(result.reply).not.toMatch(/查日志/);
    expect(result.reply).not.toMatch(/执行命令/);
    // 不含技术关键词的普通句保留（正则不误伤）
    expect(result.reply).toContain('我会尽快帮您反馈');
  });
});
