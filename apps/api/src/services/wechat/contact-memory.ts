/**
 * apps/api/src/services/wechat/contact-memory.ts — 微信客服回复引擎「③ 客户记忆」
 *
 * 三层记忆（spec 3.4）：
 *   - 短期：wechat_messages 原文逐条（不砍字数）。
 *   - 中期：wechat_contact_memory.summary 滚动摘要。
 *   - 长期：wechat_contact_memory.facts(jsonb) 稳定事实。
 *
 * 模型本身无记忆，「记得住」靠我们每次调用前自己拼上下文。本文件只负责
 * 读写两张表 + 固化（consolidate）；装配交给 context-assembler.ts。
 *
 * 容错纪律（与 wechat-draft.ts 一致）：DB / LLM / 外部失败一律 console.warn 不抛，
 * 绝不阻塞回复主链路。
 *
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-engine-design.md（3.4 + 第 4 节）
 */

import pool from '../../db/connection';
import { callOpenRouter } from '../../llm/openrouter';
import type {
  ChatMessage,
  ContactFact,
  ContactMemory,
  Direction,
  FactCategory,
} from './types';

// ─── 配置（env 门控，全部带默认值）─────────────────────────────────────────────

/** getShortTerm 默认返回最近多少条 */
function shortTermLimit(): number {
  const n = parseInt(process.env.WECHAT_SHORT_TERM_LIMIT || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

/** consolidate 触发阈值：未固化消息数 ≥ 此值时触发 */
function consolidateThreshold(): number {
  const n = parseInt(process.env.WECHAT_CONSOLIDATE_THRESHOLD || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

// ─── 内部：DB 行类型 ────────────────────────────────────────────────────────────

interface MessageRow {
  id: number | string;
  sender_name: string;
  direction: Direction;
  content: string;
  created_at: Date | string;
}

// ─── 1) appendMessage：写一条消息到短期表 ──────────────────────────────────────

/**
 * 追加一条对话消息（短期记忆原文逐条入库，不砍字数）。
 * DB 失败 → console.warn 不抛。
 *
 * csWechatId（S3 客服工作汇总）：处理该消息的客服微信号，落库时盖身份章供按客服聚合统计。
 * optional + 默认 null（向后兼容既有 caller / 老数据）；解析不到 → null，统计时不计入、不串台。
 */
export async function appendMessage(
  contactKey: string,
  senderName: string,
  direction: Direction,
  content: string,
  csWechatId?: string | null,
  opts?: { status?: 'draft' | 'delivered' },
): Promise<number | null> {
  try {
    // status 台账：out 行由 caller 传 'draft'（AI 已生成、真机未确认送达），
    // 真送达回执再置 delivered/failed；in 行与缺省一律 delivered（语义不变）。
    const status = opts?.status ?? 'delivered';
    const res = await pool.query(
      `INSERT INTO zenithjoy.wechat_messages (contact_key, sender_name, direction, content, cs_wechat_id, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [contactKey, senderName, direction, content, csWechatId ?? null, status],
    );
    // id 是 BIGSERIAL，node-postgres 返回字符串 → 转 number（对齐 tenant-memory.ts 约定）
    return res.rows?.[0]?.id != null ? Number(res.rows[0].id) : null;
  } catch (err) {
    console.warn('[contact-memory] appendMessage 写入失败:', err);
    return null;
  }
}

// ─── 1b) markMessageReceipt：agent 真送达回执，翻 draft → delivered/failed ──────

/**
 * agent 真机发送后回报：把该 out 草稿行翻成 delivered（成功）/ failed（失败）。
 *
 * WHERE 三条件缺一不可：
 *   - id = $1：目标行
 *   - cs_wechat_id = $3：归属校验（防跨租户翻别人客服的行）
 *   - direction = 'out' AND status = 'draft'：只翻本客服自己那条待确认草稿；已 delivered/
 *     failed 的行不再命中 → 幂等（重复回执 / 翻已终态行都是 no-op）。
 *
 * 命中（翻了 1 行）返回 true；未命中（不归属 / 已翻过 / 不存在）返回 false。
 * DB 失败 → console.warn 不抛，返回 false（与本文件容错纪律一致）。
 */
export async function markMessageReceipt(
  messageId: number,
  ok: boolean,
  csWechatId: string,
): Promise<boolean> {
  try {
    const res = await pool.query(
      `UPDATE zenithjoy.wechat_messages
          SET status = $2
        WHERE id = $1 AND cs_wechat_id = $3 AND direction = 'out' AND status = 'draft'
        RETURNING id`,
      [messageId, ok ? 'delivered' : 'failed', csWechatId],
    );
    return (res.rows?.length ?? 0) > 0;
  } catch (err) {
    console.warn('[contact-memory] markMessageReceipt 失败(已吞):', err);
    return false;
  }
}

// ─── 2) getShortTerm：取最近 N 条，最终按 created_at ASC ────────────────────────

/**
 * 取该联系人最近 limit 条消息，**按 created_at ASC**（最旧→最新）返回。
 * 实现：先 DESC LIMIT 取最近 N 条，再翻转成 ASC（否则 ASC LIMIT 会拿到最早的 N 条）。
 * DB 失败 → console.warn 返回空数组。
 */
export async function getShortTerm(
  contactKey: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const n = limit && limit > 0 ? limit : shortTermLimit();
  try {
    const res = await pool.query(
      `SELECT direction, content, created_at
         FROM zenithjoy.wechat_messages
        WHERE contact_key = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [contactKey, n],
    );
    const rows = (res.rows ?? []) as MessageRow[];
    // DESC 取最近 N 条 → reverse 成 ASC（最旧→最新）
    return rows
      .map((r): ChatMessage => ({
        direction: r.direction,
        content: r.content,
        created_at:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : String(r.created_at),
      }))
      .reverse();
  } catch (err) {
    console.warn('[contact-memory] getShortTerm 读取失败:', err);
    return [];
  }
}

// ─── 3) getContactMemory：取中期摘要 + 长期事实 ────────────────────────────────

/**
 * 取该联系人的中期摘要 + 长期事实。
 * 无记录 → {summary:'', facts:[]}；DB 失败同样降级为空记忆。
 */
export async function getContactMemory(
  contactKey: string,
): Promise<ContactMemory> {
  try {
    const res = await pool.query(
      `SELECT summary, facts
         FROM zenithjoy.wechat_contact_memory
        WHERE contact_key = $1`,
      [contactKey],
    );
    const row = res.rows?.[0];
    if (!row) return { summary: '', facts: [] };
    return {
      summary: typeof row.summary === 'string' ? row.summary : '',
      facts: parseFacts(row.facts),
    };
  } catch (err) {
    console.warn('[contact-memory] getContactMemory 读取失败:', err);
    return { summary: '', facts: [] };
  }
}

/** 把 jsonb 列（node-pg 可能给对象，也可能给字符串）解析成 ContactFact[]。 */
function parseFacts(raw: unknown): ContactFact[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[])
    .filter((f): f is Record<string, unknown> => {
      if (!f || typeof f !== 'object') return false;
      const o = f as Record<string, unknown>;
      return typeof o.category === 'string' && typeof o.content === 'string';
    })
    .map((o) => ({
      category: o.category as FactCategory,
      content: o.content as string,
    }));
}

// ─── 4) consolidate：固化（短期 → 中/长期）────────────────────────────────────

interface ConsolidatePayload {
  summary: string;
  facts: ContactFact[];
}

/**
 * 固化：未固化消息数 ≥ 阈值（WECHAT_CONSOLIDATE_THRESHOLD，默认 8）或 opts.force 时触发。
 *   1. 读未固化消息 + 现有 summary/facts
 *   2. 调一次 callOpenRouter（purpose:'wechat_consolidate'，只输出 JSON）
 *   3. 解析（容错，失败静默跳过）
 *   4. summary 覆盖更新；facts 按 (category+content) 去重合并
 *   5. upsert wechat_contact_memory + 已读消息标 consolidated=true + last_consolidated_at=now()
 * 全程 try/catch，任何失败 console.warn 不抛（不阻塞回复）。
 */
export async function consolidate(
  contactKey: string,
  opts?: { force?: boolean },
): Promise<void> {
  try {
    // 1) 读未固化消息
    const pending = await pool.query(
      `SELECT id, sender_name, direction, content, created_at
         FROM zenithjoy.wechat_messages
        WHERE contact_key = $1 AND consolidated = FALSE
        ORDER BY created_at ASC, id ASC`,
      [contactKey],
    );
    const rows = (pending.rows ?? []) as MessageRow[];
    const force = opts?.force === true;

    // 没有未固化消息：无可固化，直接返回（force 也无意义）
    if (rows.length === 0) return;
    // 未达阈值且非强制 → 不触发
    if (!force && rows.length < consolidateThreshold()) return;

    // 读现有 summary/facts
    const existing = await getContactMemory(contactKey);

    // 2) 调 LLM 抽取
    const prompt = buildConsolidatePrompt(rows, existing);
    let llmContent = '';
    try {
      const result = await callOpenRouter({
        prompt,
        purpose: 'wechat_consolidate',
        model: 'deepseek/deepseek-chat',
        maxTokens: 800,
      });
      llmContent = result.content || '';
    } catch (err) {
      console.warn('[contact-memory] consolidate LLM 调用失败，跳过:', err);
      return;
    }

    // 3) 解析（容错，失败静默跳过，不动 DB）
    const parsed = parseConsolidateOutput(llmContent);
    if (!parsed) {
      console.warn('[contact-memory] consolidate LLM 输出非法 JSON，跳过本次固化');
      return;
    }

    // 4) 合并：summary 覆盖（空则保留旧的）；facts 去重合并
    const newSummary = parsed.summary.trim() || existing.summary;
    const mergedFacts = mergeFacts(existing.facts, parsed.facts);

    // 5) upsert memory + 标记已读消息
    const senderName = pickSenderName(rows);
    await pool.query(
      `INSERT INTO zenithjoy.wechat_contact_memory
         (contact_key, sender_name, summary, facts, last_consolidated_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now(), now())
       ON CONFLICT (contact_key) DO UPDATE
         SET sender_name          = COALESCE(EXCLUDED.sender_name, zenithjoy.wechat_contact_memory.sender_name),
             summary              = EXCLUDED.summary,
             facts                = EXCLUDED.facts,
             last_consolidated_at = now(),
             updated_at           = now()`,
      [contactKey, senderName, newSummary, JSON.stringify(mergedFacts)],
    );

    const ids = rows.map((r) => r.id);
    await pool.query(
      `UPDATE zenithjoy.wechat_messages
          SET consolidated = TRUE
        WHERE contact_key = $1 AND id = ANY($2::bigint[])`,
      [contactKey, ids],
    );

    // 固化成功后单向推飞书（env 门控，默认 no-op）
    await syncFactsToFeishu(contactKey, mergedFacts);
  } catch (err) {
    console.warn('[contact-memory] consolidate 失败:', err);
  }
}

/** 从未固化消息里挑一个客户侧（in）的 sender_name，没有就取第一条。 */
function pickSenderName(rows: MessageRow[]): string | null {
  const inbound = rows.find((r) => r.direction === 'in');
  return (inbound ?? rows[0])?.sender_name ?? null;
}

/** 拼固化 prompt：要求模型**只输出 JSON**。 */
function buildConsolidatePrompt(rows: MessageRow[], existing: ContactMemory): string {
  const dialogue = rows
    .map((r) => `${r.direction === 'in' ? '客户' : '我'}: ${r.content}`)
    .join('\n');
  const existingFacts =
    existing.facts.length > 0
      ? existing.facts.map((f) => `- [${f.category}] ${f.content}`).join('\n')
      : '（无）';
  return [
    '你是一个对话记忆固化器。下面是和某位客户的一段对话，以及已有的摘要和长期事实。',
    '请：1) 更新一份简洁的中期摘要（≤200 字，覆盖整段关系状态）；',
    '2) 抽取稳定的长期事实（称呼/身份/偏好/承诺/禁忌/其他），只记真正长期有用、跨对话仍成立的事实，临时寒暄不要记。',
    '',
    '已有摘要：',
    existing.summary || '（无）',
    '',
    '已有长期事实：',
    existingFacts,
    '',
    '新的对话：',
    dialogue,
    '',
    '严格只输出 JSON，不要任何解释、不要 markdown 代码块，格式：',
    '{"summary":"...","facts":[{"category":"称呼|身份|偏好|承诺|禁忌|其他","content":"..."}]}',
  ].join('\n');
}

/** 解析 LLM 输出（容错：剥 markdown 围栏、截取首个 JSON 对象）。失败返回 null。 */
function parseConsolidateOutput(raw: string): ConsolidatePayload | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  // 剥 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 截取第一个 { 到最后一个 }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const summary = typeof o.summary === 'string' ? o.summary : '';
  const facts = parseFacts(o.facts);
  return { summary, facts };
}

/** facts 按 (category + ' ' + content) 去重合并；旧的在前，新的去重追加。 */
function mergeFacts(
  oldFacts: ContactFact[],
  newFacts: ContactFact[],
): ContactFact[] {
  const seen = new Set<string>();
  const out: ContactFact[] = [];
  const key = (f: ContactFact) => `${f.category} ${f.content}`;
  for (const f of [...oldFacts, ...newFacts]) {
    if (!f || !f.content) continue;
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ category: f.category, content: f.content });
  }
  return out;
}

// ─── 5) syncFactsToFeishu：单向 push 飞书（Sprint A 最小，env 门控）────────────

/**
 * 把 facts 单向推一张飞书表给人看（**Sprint A 范围仅做 env 门控 best-effort**）。
 *
 * Sprint A 边界：引擎读 facts 以 DB 为准；飞书读回人工编辑（飞书优先）放到 Sprint C
 * 随中台编辑 UI 一起做。这里**不从零写飞书 client** —— 默认 no-op，只有
 * WECHAT_FEISHU_FACTS_SYNC=1 且配置了表 id 时才尝试，且任何失败都 console.warn 不抛。
 */
export async function syncFactsToFeishu(
  contactKey: string,
  facts: ContactFact[],
): Promise<void> {
  // 门控：默认关闭直接 return（no-op）
  if (process.env.WECHAT_FEISHU_FACTS_SYNC !== '1') return;
  const tableId = process.env.WECHAT_FEISHU_FACTS_TABLE_ID || '';
  if (!tableId) {
    console.warn(
      '[contact-memory] WECHAT_FEISHU_FACTS_SYNC=1 但未配置 WECHAT_FEISHU_FACTS_TABLE_ID，跳过同步',
    );
    return;
  }
  try {
    // Sprint A 占位：真实飞书 client 接入留到 Sprint C 中台编辑 UI 一起做。
    // 这里仅记录意图，避免在引擎里复制一份飞书 client。
    console.warn(
      `[contact-memory] (Sprint A best-effort) 拟向飞书表 ${tableId} 推送 contact=${contactKey} 的 ${facts.length} 条 facts —— 真实推送实现待 Sprint C`,
    );
  } catch (err) {
    console.warn('[contact-memory] syncFactsToFeishu 失败:', err);
  }
}
