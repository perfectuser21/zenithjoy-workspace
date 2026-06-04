/**
 * context-assembler 纯函数单测。
 *
 * 隔离测试装配逻辑：mock 掉 './persona' 与 './business-kb'，
 * 让 renderPersonaBlock → "PERSONA_BLOCK"、renderKBBlock → "KB_BLOCK"，
 * 这样不依赖队友（agent-knowledge）的实现进度。
 *
 * 跑：cd apps/api && npx vitest run src/services/wechat/__tests__/context-assembler.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { assembleChatContext } from '../context-assembler';
import type {
  BusinessKB,
  ChatMessage,
  ContactMemory,
  KBHit,
  Persona,
} from '../types';

vi.mock('../persona', () => ({
  renderPersonaBlock: () => 'PERSONA_BLOCK',
}));
vi.mock('../business-kb', () => ({
  renderKBBlock: () => 'KB_BLOCK',
}));

const TRIM_MARKER = '…(更早内容略)';

// ─── 公共 fixtures（persona / kb 被 mock，内容无所谓，给最小占位即可）─────────
const persona = {} as Persona;
const kb = {} as BusinessKB;
const kbHits: KBHit[] = [];

function msg(direction: 'in' | 'out', content: string, t: string): ChatMessage {
  return { direction, content, created_at: t };
}

describe('assembleChatContext', () => {
  it('system 同时含 PERSONA_BLOCK + KB_BLOCK', () => {
    const memory: ContactMemory = { summary: '', facts: [] };
    const { system } = assembleChatContext({
      message: '你好',
      persona,
      kb,
      kbHits,
      shortTerm: [],
      memory,
    });
    expect(system).toContain('PERSONA_BLOCK');
    expect(system).toContain('KB_BLOCK');
  });

  it('user 含长期事实 + 最近原文 + 摘要 + 最新消息，且最新消息在最后', () => {
    const memory: ContactMemory = {
      summary: '客户上周问过价格，还在比较几家方案。',
      facts: [
        { category: '称呼', content: '叫他张哥' },
        { category: '禁忌', content: '花生过敏' },
      ],
    };
    const shortTerm: ChatMessage[] = [
      msg('in', '上次那个方案我还在想', '2026-06-01T10:00:00Z'),
      msg('out', '行 不急，想好随时找我', '2026-06-01T10:01:00Z'),
    ];

    const { user } = assembleChatContext({
      message: '再帮我算下价格',
      persona,
      kb,
      kbHits,
      shortTerm,
      memory,
    });

    // 长期事实
    expect(user).toContain('关于这个人我记得');
    expect(user).toContain('称呼：叫他张哥');
    expect(user).toContain('禁忌：花生过敏');
    // 最近原文（含发言人前缀）
    expect(user).toContain('客户：上次那个方案我还在想');
    expect(user).toContain('我：行 不急，想好随时找我');
    // 中期摘要
    expect(user).toContain('客户上周问过价格');
    // 最新消息且在最后
    const latest = '[客户最新消息: 再帮我算下价格]';
    expect(user).toContain(latest);
    expect(user.trimEnd().endsWith(latest)).toBe(true);

    // 拼装顺序：长期事实 → 最近聊天 → 摘要 → 最新消息
    expect(user.indexOf('[长期事实]')).toBeLessThan(user.indexOf('[最近聊天]'));
    expect(user.indexOf('[最近聊天]')).toBeLessThan(user.indexOf('[之前对话摘要]'));
    expect(user.indexOf('[之前对话摘要]')).toBeLessThan(user.indexOf(latest));
  });

  it('预算裁剪：超长 shortTerm + 长摘要 → 摘要先被砍，最新消息与长期事实仍在', () => {
    const summaryUnique = 'SUMMARY_LONG_TEXT';
    const memory: ContactMemory = {
      summary: summaryUnique.repeat(40), // ~640 字符
      facts: [{ category: '禁忌', content: '花生过敏' }],
    };
    // 超长短期：每条都带唯一标记，方便断言最旧的被砍
    const shortTerm: ChatMessage[] = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'in' : 'out', `第${i}条消息内容`.padEnd(40, '填'), `2026-06-01T10:${String(i).padStart(2, '0')}:00Z`),
    );

    const message = '最新问题在此';
    const { user } = assembleChatContext({
      message,
      persona,
      kb,
      kbHits,
      shortTerm,
      memory,
      maxChars: 300,
    });

    // 摘要原文被砍（先砍中期摘要），留标记
    expect(user).not.toContain(summaryUnique);
    expect(user).toContain(TRIM_MARKER);
    // 长期事实永不砍
    expect(user).toContain('花生过敏');
    // 最新消息永不砍，且在最后
    const latest = `[客户最新消息: ${message}]`;
    expect(user).toContain(latest);
    expect(user.trimEnd().endsWith(latest)).toBe(true);
    // 整体不超预算（facts+latest 本身远小于 300）
    expect(user.length).toBeLessThanOrEqual(300);
  });

  it('摘要砍完仍超预算时，从最旧的短期消息开始砍（保留较新的）', () => {
    const memory: ContactMemory = { summary: '', facts: [] };
    const shortTerm: ChatMessage[] = [
      msg('in', 'OLDEST_MSG_应该被砍', '2026-06-01T10:00:00Z'),
      msg('out', 'MIDDLE_MSG', '2026-06-01T10:01:00Z'),
      msg('in', 'NEWEST_MSG_应该保留并且很长很长很长很长很长很长很长很长', '2026-06-01T10:02:00Z'),
    ];
    const { user } = assembleChatContext({
      message: 'q',
      persona,
      kb,
      kbHits,
      shortTerm,
      memory,
      maxChars: 80,
    });
    // 最旧的被砍，最新的保留
    expect(user).not.toContain('OLDEST_MSG_应该被砍');
    expect(user).toContain('NEWEST_MSG_应该保留');
    expect(user).toContain(TRIM_MARKER);
    expect(user).toContain('[客户最新消息: q]');
  });

  it('空 memory / 空 shortTerm 不报错，只输出最新消息段', () => {
    const memory: ContactMemory = { summary: '', facts: [] };
    expect(() =>
      assembleChatContext({
        message: '在吗',
        persona,
        kb,
        kbHits,
        shortTerm: [],
        memory,
      }),
    ).not.toThrow();

    const { user } = assembleChatContext({
      message: '在吗',
      persona,
      kb,
      kbHits,
      shortTerm: [],
      memory,
    });
    expect(user).toContain('[客户最新消息: 在吗]');
    expect(user).not.toContain('[长期事实]');
    expect(user).not.toContain('[最近聊天]');
    expect(user).not.toContain('[之前对话摘要]');
  });
});
