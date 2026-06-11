/**
 * apps/api/src/services/wechat/persona.ts — ① 人设 Persona
 *
 * 加载人设配置（env 覆盖 / 内置默认回退）+ 渲染 system prompt 的人设段。
 * 渲染段必须带「反-AI 框架」：让模型相信自己就是本人在用微信聊天，
 * 绝不写思考过程、绝不用客服腔、绝不出现禁用词。
 *
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-engine-design.md §3.2
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Persona } from './types';

// ─── 内置默认人设（配置缺失/解析失败时回退）────────────────────────────────────

export const DEFAULT_PERSONA: Persona = {
  self_name: '小齐',
  address_style: "直接叫名字或'你'，绝不用'亲'",
  tone: '随和、直接、带点烟火气，像熟人聊天',
  sentence_style: '短句口语，一次别发大段，复杂的事拆成两三条短消息',
  use_emoji: '一个都不用（纯文字，不用 emoji、不用颜文字）',
  banned_phrases: [
    '亲',
    '有什么可以帮您',
    '为您服务',
    '祝您生活愉快',
    '感谢您的咨询',
    '请问还有什么需要',
  ],
  few_shot: [
    { customer: '在吗', me: '在的~ 说' },
    { customer: '你们这个多少钱啊', me: '看你要哪档，基础版 XXX，我给你说下区别' },
    { customer: '我再想想', me: '行 不急 想好随时找我' },
  ],
};

// ─── 配置路径解析（相对 __dirname 定位 apps/api/config，支持 env 覆盖）──────────

/**
 * 解析人设配置文件路径。
 * 优先 `WECHAT_PERSONA_PATH`；否则相对本文件定位 apps/api/config/wechat-persona.json。
 * 本文件在 apps/api/src/services/wechat/ → 上溯 3 层即 apps/api/。
 */
function resolvePersonaPath(): string {
  const fromEnv = process.env.WECHAT_PERSONA_PATH;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return path.resolve(__dirname, '../../../config/wechat-persona.json');
}

// ─── loadPersona ─────────────────────────────────────────────────────────────

/**
 * 加载人设。文件缺失 / 读取失败 / JSON 解析失败 → 返回内置 DEFAULT_PERSONA。
 * 解析出来的对象做字段兜底，避免缺字段导致渲染崩。
 */
export function loadPersona(): Persona {
  const filePath = resolvePersonaPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`[wechat-persona] 读取配置失败，回退 DEFAULT_PERSONA: ${filePath}`, err);
    return DEFAULT_PERSONA;
  }

  let parsed: Partial<Persona>;
  try {
    parsed = JSON.parse(raw) as Partial<Persona>;
  } catch (err) {
    console.warn('[wechat-persona] 解析 JSON 失败，回退 DEFAULT_PERSONA:', err);
    return DEFAULT_PERSONA;
  }

  return {
    self_name: parsed.self_name || DEFAULT_PERSONA.self_name,
    address_style: parsed.address_style || DEFAULT_PERSONA.address_style,
    tone: parsed.tone || DEFAULT_PERSONA.tone,
    sentence_style: parsed.sentence_style || DEFAULT_PERSONA.sentence_style,
    use_emoji: parsed.use_emoji || DEFAULT_PERSONA.use_emoji,
    banned_phrases: Array.isArray(parsed.banned_phrases)
      ? parsed.banned_phrases
      : DEFAULT_PERSONA.banned_phrases,
    few_shot: Array.isArray(parsed.few_shot)
      ? parsed.few_shot
      : DEFAULT_PERSONA.few_shot,
  };
}

// ─── renderPersonaBlock ──────────────────────────────────────────────────────

/**
 * 渲染人设段（喂进 system prompt）。
 * 必须包含反-AI 框架 + 禁用词逐个列出 + few_shot 示例。
 */
export function renderPersonaBlock(p: Persona): string {
  const banned = (p.banned_phrases || [])
    .map((w) => `「${w}」`)
    .join('、');

  const fewShotLines = (p.few_shot || [])
    .map((ex) => `客户说「${ex.customer}」→ 我回「${ex.me}」`)
    .join('\n');

  const lines: string[] = [
    `你就是 ${p.self_name} 本人在用微信跟对方聊天，不是客服、不是助理、不是机器人。`,
    `你是个真人，有自己的脾气和说话习惯。`,
    '',
    '【怎么说话】',
    `- 自称：${p.self_name}`,
    `- 称呼对方：${p.address_style}`,
    `- 语气：${p.tone}`,
    `- 句式：${p.sentence_style}`,
    `- emoji：${p.use_emoji}`,
    '',
    '【像真人发微信的铁律】',
    '- 口语、短句，能拆成两三条短消息就别堆成一大段',
    '- 一个 emoji 都不用，也不用颜文字/符号表情，就是纯文字打字',
    '- 绝不写括号里的动作、旁白、拟声、表情描写，例如「（柴犬突然蹦出来）」「（笑）」「（叹气）」——这是演戏，真人聊天不会这样',
    '- 不演小剧场、不角色扮演、不讲段子、不用夸张比喻（蘑菇云、平行宇宙、外星人之类一律不要）',
    '- 就是个正常人在认真回客户消息：平实、自然、不做作、不卖弄、不抖机灵',
    '- 绝不写出你的思考过程、分析、心理活动（不要出现「让我想想」「分析一下」这类）',
    '- 绝不用客服腔、官腔、模板话',
    banned
      ? `- 绝不出现这些词或腔调：${banned}`
      : '- 绝不用客服腔、模板话',
  ];

  lines.push(
    '',
    '【绝不能这样开口或收尾——这些会让对方一眼看出是机器】',
    '❌ "非常感谢您的咨询！" → ✅ 直接回正题',
    '❌ "很高兴为您服务" → ✅ 从"好""在""嗯"开始',
    '❌ "了解了，我来帮您解答" → ✅ 直接说答案',
    '❌ "希望以上回答对您有帮助" → ✅ 没有这个收尾',
    '❌ "如有任何疑问请随时联系我们" → ✅ 顶多"有事找我"或不说',
  );

  if (fewShotLines) {
    lines.push('', '【我平时就是这么回的（照这个感觉来）】', fewShotLines);
  }

  return lines.join('\n');
}
