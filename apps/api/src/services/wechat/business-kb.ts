/**
 * apps/api/src/services/wechat/business-kb.ts — ② 企业知识库 BusinessKB
 *
 * 加载企业知识库配置（env 覆盖 / 内置空壳回退）+ 关键词/子串重叠检索 + 渲染 block。
 * thin 阶段不用 embedding，纯关键词重叠打分（中文按 bigram + 单字，英文按词）。
 *
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-engine-design.md §3.3
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BusinessKB, KBHit } from './types';

// ─── 内置空壳（配置缺失/解析失败时回退）────────────────────────────────────────

export const EMPTY_KB: BusinessKB = {
  company: { name: '', what_we_do: '', value_prop: '', contact: '' },
  products: [],
  audience_segments: [],
  qa_docs: [],
};

// ─── 配置路径解析（相对 __dirname 定位 apps/api/config，支持 env 覆盖）──────────

function resolveKBPath(): string {
  const fromEnv = process.env.WECHAT_BUSINESS_KB_PATH;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return path.resolve(__dirname, '../../../config/wechat-business-kb.json');
}

// ─── loadBusinessKB ──────────────────────────────────────────────────────────

/**
 * 加载企业知识库。文件缺失 / 读取失败 / JSON 解析失败 → 返回内置 EMPTY_KB。
 * 对各字段做兜底，保证返回结构完整（company 全字段 + 4 个数组）。
 */
export function loadBusinessKB(): BusinessKB {
  const filePath = resolveKBPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`[wechat-business-kb] 读取配置失败，回退 EMPTY_KB: ${filePath}`, err);
    return cloneEmptyKB();
  }

  let parsed: Partial<BusinessKB>;
  try {
    parsed = JSON.parse(raw) as Partial<BusinessKB>;
  } catch (err) {
    console.warn('[wechat-business-kb] 解析 JSON 失败，回退 EMPTY_KB:', err);
    return cloneEmptyKB();
  }

  const company = parsed.company || EMPTY_KB.company;
  return {
    company: {
      name: company.name || '',
      what_we_do: company.what_we_do || '',
      value_prop: company.value_prop || '',
      contact: company.contact || '',
    },
    products: Array.isArray(parsed.products) ? parsed.products : [],
    audience_segments: Array.isArray(parsed.audience_segments)
      ? parsed.audience_segments
      : [],
    qa_docs: Array.isArray(parsed.qa_docs) ? parsed.qa_docs : [],
  };
}

function cloneEmptyKB(): BusinessKB {
  return {
    company: { name: '', what_we_do: '', value_prop: '', contact: '' },
    products: [],
    audience_segments: [],
    qa_docs: [],
  };
}

// ─── 关键词/子串重叠打分 ────────────────────────────────────────────────────────

/**
 * 把文本切成可用于重叠打分的 token 集合：
 *   - 英文/数字：长度 ≥2 的连续串（小写）
 *   - 中文：连续汉字串的 bigram；单字汉字串保留该单字
 * 用 Set 去重，避免同 token 重复计分。
 */
function tokenize(text: string): Set<string> {
  const lower = (text || '').toLowerCase();
  const tokens = new Set<string>();

  for (const m of lower.match(/[a-z0-9]+/g) || []) {
    if (m.length >= 2) tokens.add(m);
  }

  for (const run of lower.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) {
      tokens.add(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      tokens.add(run.slice(i, i + 2));
    }
  }

  return tokens;
}

/**
 * 用 message 的 token 与 docText 做子串重叠打分：每个在 docText 中出现的 token +1。
 */
function scoreOverlap(messageTokens: Set<string>, docText: string): number {
  const docLower = (docText || '').toLowerCase();
  if (!docLower) return 0;
  let score = 0;
  for (const t of messageTokens) {
    if (docLower.includes(t)) score += 1;
  }
  return score;
}

function renderProductText(name: string, sellingPoints: string, price?: string): string {
  const priceSeg = price ? ` 价格 ${price}` : '';
  return `产品 ${name}：卖点 ${sellingPoints}${priceSeg}`;
}

function renderQAText(q: string, a: string): string {
  return `Q: ${q} / A: ${a}`;
}

/**
 * 关键词/子串重叠检索：对 qa_docs（q+a）与 products（name+selling_points）打分，
 * 按分降序取 topK（默认 3）。命中 0 条返回空数组。
 */
export function retrieveRelevantKB(
  message: string,
  kb: BusinessKB,
  topK = 3,
): KBHit[] {
  if (!message || !message.trim() || !kb) return [];
  const messageTokens = tokenize(message);
  if (messageTokens.size === 0) return [];

  const candidates: KBHit[] = [];

  for (const doc of kb.qa_docs || []) {
    const score = scoreOverlap(messageTokens, `${doc.q} ${doc.a}`);
    if (score > 0) {
      candidates.push({ kind: 'qa', text: renderQAText(doc.q, doc.a), score });
    }
  }

  for (const product of kb.products || []) {
    const score = scoreOverlap(
      messageTokens,
      `${product.name} ${product.selling_points}`,
    );
    if (score > 0) {
      candidates.push({
        kind: 'product',
        text: renderProductText(
          product.name,
          product.selling_points,
          product.price,
        ),
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, Math.max(0, topK));
}

// ─── renderKBBlock ───────────────────────────────────────────────────────────

/**
 * 渲染企业知识库段：
 *   - 始终输出企业基本信息（name / what_we_do / value_prop / contact）
 *   - 命中的 hits 作为「可参考资料」附上
 *   - 加一句以资料为准、没依据别编的硬规则
 */
export function renderKBBlock(kb: BusinessKB, hits: KBHit[]): string {
  const c = (kb && kb.company) || EMPTY_KB.company;
  const lines: string[] = ['【你的生意（企业基本信息）】'];

  if (c.name) lines.push(`- 公司：${c.name}`);
  if (c.what_we_do) lines.push(`- 在做什么：${c.what_we_do}`);
  if (c.value_prop) lines.push(`- 核心价值：${c.value_prop}`);
  if (c.contact) lines.push(`- 联系方式：${c.contact}`);
  if (lines.length === 1) {
    lines.push('-（暂无企业资料）');
  }

  if (hits && hits.length > 0) {
    lines.push('', '【可参考资料（与本次提问相关）】');
    hits.forEach((h, i) => {
      lines.push(`${i + 1}. ${h.text}`);
    });
  }

  lines.push(
    '',
    '答产品/价格问题以上面资料为准；没有依据就说「我去帮你确认下」，别编。',
  );

  return lines.join('\n');
}
