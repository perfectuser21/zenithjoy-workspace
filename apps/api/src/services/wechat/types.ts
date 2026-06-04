/**
 * apps/api/src/services/wechat/types.ts — 微信客服回复引擎共享类型契约
 *
 * 本文件是 Sprint A 后端引擎所有模块的接口合同。persona / business-kb /
 * contact-memory / context-assembler 全部 import 这里的类型，不得各自另定义。
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-engine-design.md
 */

// ─── ① 人设 Persona ────────────────────────────────────────────────────────────

export interface PersonaFewShot {
  customer: string; // 客户这么说
  me: string; // 我会这么回
}

export interface Persona {
  self_name: string; // 我的自称
  address_style: string; // 怎么称呼客户
  tone: string; // 语气基调
  sentence_style: string; // 句长 / 拆句偏好
  use_emoji: string; // emoji 使用习惯
  banned_phrases: string[]; // 禁用词 / 禁用腔
  few_shot: PersonaFewShot[];
}

// ─── ② 企业知识库 BusinessKB ────────────────────────────────────────────────────

export interface KBCompany {
  name: string;
  what_we_do: string;
  value_prop: string;
  contact: string;
}

export interface KBProduct {
  name: string;
  selling_points: string;
  price?: string;
}

export interface KBAudienceSegment {
  code: string; // A1 / A2 / ...
  label: string;
  desc: string;
}

export interface KBQADoc {
  q: string;
  a: string;
}

export interface BusinessKB {
  company: KBCompany;
  products: KBProduct[];
  audience_segments: KBAudienceSegment[];
  qa_docs: KBQADoc[];
}

export interface KBHit {
  kind: 'qa' | 'product';
  text: string; // 已渲染成可读文本
  score: number; // 关键词重叠打分，越高越相关
}

// ─── ③ 客户记忆 ContactMemory ───────────────────────────────────────────────────

export type FactCategory = '称呼' | '身份' | '偏好' | '承诺' | '禁忌' | '其他';

export interface ContactFact {
  category: FactCategory;
  content: string;
}

export interface ContactMemory {
  summary: string; // 中期：滚动摘要
  facts: ContactFact[]; // 长期：稳定事实
}

export type Direction = 'in' | 'out'; // in = 客户说, out = 我方回

export interface ChatMessage {
  direction: Direction;
  content: string;
  created_at: string; // ISO 字符串
}

// ─── 装配结果 ────────────────────────────────────────────────────────────────────

export interface AssembledContext {
  system: string; // 给 LLM 的 system 段（人设 + 企业信息）
  user: string; // 给 LLM 的 user 段（长期事实 → 中期摘要 → 短期原文 → 最新消息）
}
