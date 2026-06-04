/**
 * apps/api/src/services/wechat/context-assembler.ts — 装配器
 *
 * 纯函数：把「三口井」（人设 + 企业知识库 + 客户记忆）和客户最新消息拼成
 * 喂给 LLM 的 {system, user}，带 token 预算裁剪。无任何 IO / 网络 / DB。
 *
 * - system = 人设 block + 企业知识库 block。
 * - user 拼装顺序：[长期事实] → [最近聊天] → [之前对话摘要] → [客户最新消息]。
 * - token 预算（maxChars 默认 6000）超额时裁剪优先级：
 *     长期事实 > 最近聊天原文 > 中期摘要
 *   即「谁先被砍」：先整段砍中期摘要，还超就从最旧的短期消息开始砍；
 *   长期事实段与「客户最新消息」永不裁剪。被砍处留 TRIM_MARKER 标记。
 *
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-engine-design.md §3.5
 */

import type {
  AssembledContext,
  BusinessKB,
  ChatMessage,
  ContactFact,
  ContactMemory,
  KBHit,
  Persona,
} from './types';
import { renderPersonaBlock } from './persona';
import { renderKBBlock } from './business-kb';

const DEFAULT_MAX_CHARS = 6000;
const TRIM_MARKER = '…(更早内容略)';

export interface AssembleChatContextInput {
  message: string;
  persona: Persona;
  kb: BusinessKB;
  kbHits: KBHit[];
  shortTerm: ChatMessage[];
  memory: ContactMemory;
  maxChars?: number;
}

// ─── 段渲染 helper ───────────────────────────────────────────────────────────

/** 长期事实段（永不裁剪）。无 facts → 空串（不渲染该段）。 */
function renderFactsBlock(facts: ContactFact[]): string {
  if (!Array.isArray(facts) || facts.length === 0) {
    return '';
  }
  const lines = facts.map((f) => `- ${f.category}：${f.content}`);
  return `[长期事实]\n关于这个人我记得：\n${lines.join('\n')}`;
}

/** 单条短期消息：in=客户 / out=我。 */
function renderChatLine(m: ChatMessage): string {
  const who = m.direction === 'in' ? '客户' : '我';
  return `${who}：${m.content}`;
}

// ─── assembleChatContext ─────────────────────────────────────────────────────

export function assembleChatContext(input: AssembleChatContextInput): AssembledContext {
  const {
    message,
    persona,
    kb,
    kbHits,
    shortTerm,
    memory,
    maxChars = DEFAULT_MAX_CHARS,
  } = input;

  const system = `${renderPersonaBlock(persona)}\n${renderKBBlock(kb, kbHits)}`;

  const factsBlock = renderFactsBlock(memory?.facts ?? []);
  const latestBlock = `[客户最新消息: ${message}]`;
  const chatLines = (shortTerm ?? []).map(renderChatLine);
  const summaryText = (memory?.summary ?? '').trim();

  /**
   * 按当前裁剪状态拼装 user 段。
   * @param keptChat   保留的（较新的）短期消息行
   * @param keepSummary 是否保留中期摘要原文
   * @param chatTrimmed 短期消息是否被砍过（被砍则在最近聊天顶部留标记）
   */
  function assemble(keptChat: string[], keepSummary: boolean, chatTrimmed: boolean): string {
    const sections: string[] = [];

    if (factsBlock) {
      sections.push(factsBlock);
    }

    // 最近聊天：只要原本有短期消息就渲染该段（即便已被砍空，留标记）
    if (chatLines.length > 0) {
      const body = chatTrimmed ? [TRIM_MARKER, ...keptChat] : [...keptChat];
      sections.push(`[最近聊天]\n${body.join('\n')}`);
    }

    // 之前对话摘要：原本有摘要才渲染；被砍则留标记
    if (summaryText) {
      sections.push(`[之前对话摘要]\n${keepSummary ? summaryText : TRIM_MARKER}`);
    }

    // 客户最新消息：永不裁剪，始终在最后
    sections.push(latestBlock);

    return sections.join('\n\n');
  }

  // 0. 全量
  let user = assemble(chatLines, true, false);
  if (user.length <= maxChars) {
    return { system, user };
  }

  // 1. 先整段砍中期摘要
  user = assemble(chatLines, false, false);
  if (user.length <= maxChars) {
    return { system, user };
  }

  // 2. 再从最旧的短期消息开始砍
  let kept = [...chatLines];
  while (kept.length > 0) {
    kept = kept.slice(1); // 丢掉最旧一条
    user = assemble(kept, false, true);
    if (user.length <= maxChars) {
      break;
    }
  }

  // 砍到只剩长期事实 + 最新消息仍可能超预算（这两段永不裁剪）——按约定原样返回
  return { system, user };
}
