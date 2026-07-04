/**
 * apps/api/src/services/wechat/tenant-memory.ts — Line04 对话记忆「三层记忆」后端
 *
 * tenant 隔离的三层记忆（per tenant_id × contact），物理独立于旧 contact_key 引擎
 * （contact-memory.ts / wechat_messages / wechat_contact_memory，本刀不动它们）：
 *   - 短期 cs_memory_messages   原文逐条滑窗
 *   - 中期 cs_memory_daily      按天 summary
 *   - 长期 cs_memory_longterm   融合压缩 summary
 *
 * 三能力：
 *   - appendTenantMessage   写一条消息进短期
 *   - getReplyContext       取「长期 + 中期 + 短期」拼好的回复上下文
 *   - runDailyConsolidation 触发日收尾：当天短期→中期；跨天中期→并入长期
 *
 * 隔离纪律：缺 tenant_id 一律抛 MISSING_TENANT，绝不回退全量；所有 DB 读写都把
 * tenant_id 作为参数过滤（隔离按 tenant_id × contact）。
 *
 * 降级纪律：summarization 经 callOpenRouter；LLM 抛错/超时/空内容 → 回落到确定性
 * 本地 summary（当天原文按「角色: 文本」截断拼接），中期/长期仍写入且非空，三层
 * 数据不被破坏。当天无消息 → 不写空中期（daily_generated=false）。
 */

import pool from '../../db/connection';
import { callOpenRouter } from '../../llm/openrouter';

/** 缺 tenant_id 时抛出（隔离纪律：绝不回退全量）。 */
export class MissingTenantError extends Error {
  constructor() {
    super('MISSING_TENANT');
    this.name = 'MissingTenantError';
  }
}

// ─── 配置 ─────────────────────────────────────────────────────────────────────

/** getReplyContext 短期原文滑窗返回最近多少条 */
function shortTermLimit(): number {
  const n = parseInt(process.env.WECHAT_TENANT_SHORT_LIMIT || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

interface ChatLine {
  role: string;
  text: string;
}

/** UTC 当天（与 Postgres now()::date 在 UTC 环境一致）。 */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDay(day?: string): string {
  const d = (day || '').trim();
  return d || todayStr();
}

function roleLabel(role: string): string {
  return role === 'in' ? '客户' : '客服';
}

function linesFromMessages(msgs: ChatLine[]): string {
  return msgs.map((m) => `${roleLabel(m.role)}: ${m.text}`).join('\n');
}

/** 确定性本地 summary（LLM 失败时降级用）：原文拼接截断，保证非空。 */
function localDailySummary(lines: string, day: string): string {
  return `[${day} 对话摘要]\n${lines}`.slice(0, 600);
}

// ─── summarization（经 callOpenRouter，失败降级本地确定性 summary）────────────

async function summarizeDay(msgs: ChatLine[], day: string): Promise<string> {
  const lines = linesFromMessages(msgs);
  try {
    const r = await callOpenRouter({
      prompt: `请用简洁中文总结 ${day} 这一天客户与客服对话的要点（150 字内，只输出要点）：\n${lines}`,
      purpose: 'wechat_cs_daily_summary',
      maxTokens: 300,
    });
    const c = (r.content || '').trim();
    if (c) return c;
  } catch (e) {
    console.warn('[tenant-memory] daily summarize 降级:', (e as Error).message);
  }
  // 降级：确定性本地 summary，绝不破坏三层数据
  return localDailySummary(lines, day);
}

async function mergeLongterm(
  oldLong: string,
  dailies: { summary_day: string; summary: string }[],
): Promise<string> {
  const dailyText = dailies.map((d) => `- ${d.summary_day}: ${d.summary}`).join('\n');
  try {
    const r = await callOpenRouter({
      prompt:
        `请把已有长期客户画像与新增每日摘要融合压缩为稳定的长期画像（200 字内，只输出画像）：\n` +
        `[已有长期]\n${oldLong || '（空）'}\n[新增每日]\n${dailyText}`,
      purpose: 'wechat_cs_longterm_merge',
      maxTokens: 400,
    });
    const c = (r.content || '').trim();
    if (c) return c;
  } catch (e) {
    console.warn('[tenant-memory] longterm merge 降级:', (e as Error).message);
  }
  // 降级：确定性融合（旧长期 + 新增每日），截断，保证非空
  const merged = `${oldLong ? oldLong + '\n' : ''}${dailyText}`.slice(0, 1000);
  return merged || dailyText.slice(0, 1000);
}

// ─── 装配 ─────────────────────────────────────────────────────────────────────

function assembleContext(longterm: string, mid: string, short: ChatLine[]): string {
  const convo = short.length ? linesFromMessages(short) : '（无）';
  return [
    `[长期记忆]\n${longterm || '（无）'}`,
    `[近期摘要]\n${mid || '（无）'}`,
    `[最近对话]\n${convo}`,
  ].join('\n\n');
}

// ─── 记忆污染过滤（v1.0.108 Bug7修复）─────────────────────────────────────────
// 客户偶发性粘贴技术指令（curl/sudo/shell/JSON）进对话框 → 进入 cs_memory_messages
// → 日收尾 LLM 摘要把"客户是个运维工程师"写进长期画像 → AI 角色人设被污染。
// 检测逻辑：仅对 'in' 角色（客户消息）过滤；匹配任一技术特征则跳过写库。
// 保守策略：宁可漏过一条技术噪音也不误删真实客户消息（阈值故意不过于激进）。

function isTechnicalCommand(text: string): boolean {
  const t = text.trim();
  return (
    /^[$#]\s+\S/.test(t) ||                         // $ command / # root-shell
    /```/.test(t) ||                                 // code block
    /\bcurl\s+https?:\/\//i.test(t) ||
    /\bsudo\s+\w/i.test(t) ||
    /\bpip\s+install\b/i.test(t) ||
    /\bnpm\s+(install|run|start|build)\b/i.test(t) ||
    /\bapt(?:-get)?\s+install\b/i.test(t) ||
    /\bpython3?\s+-[cm]\b/i.test(t) ||
    /\bchmod\s+[0-7]{3,4}\b/i.test(t) ||
    /^\s*\{[\s\S]{0,500}"[^"]+"\s*:/.test(t)        // JSON object
  );
}

// ─── 1) appendTenantMessage：写一条消息进短期 ─────────────────────────────────

export async function appendTenantMessage(input: {
  tenantId: string;
  contact: string;
  role: 'in' | 'out';
  text: string;
  /**
   * 客服微信号身份章（盖到被 stats 聚合的 cs_memory_messages 行上）。
   * 经身份解析链 agent_id→machine→service_agents→wechat_id 解出；解不到 → null（向后兼容，
   * stats 聚合不计入任何客服、不报错）。缺省 null = 不盖章（既有非客服 caller 行为不变）。
   */
  csWechatId?: string | null;
}): Promise<{ message_id: number }> {
  const tenantId = (input.tenantId || '').trim();
  if (!tenantId) throw new MissingTenantError();

  if (input.role === 'in' && isTechnicalCommand(input.text)) {
    return { message_id: 0 }; // 技术指令噪音：跳过写库，不污染记忆
  }

  const res = await pool.query(
    `INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text, cs_wechat_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [tenantId, input.contact, input.role, input.text, input.csWechatId ?? null],
  );
  return { message_id: Number(res.rows[0].id) };
}

// ─── 2) getReplyContext：取「长期 + 中期 + 短期」回复上下文 ────────────────────

export async function getReplyContext(input: {
  tenantId: string;
  contact: string;
}): Promise<{
  context: { longterm: string; mid: string; short: ChatLine[] };
  assembled: string;
}> {
  const tenantId = (input.tenantId || '').trim();
  if (!tenantId) throw new MissingTenantError();
  const contact = input.contact;

  // 长期（无→空串）
  const ltRes = await pool.query(
    `SELECT summary FROM zenithjoy.cs_memory_longterm
      WHERE tenant_id = $1 AND contact = $2`,
    [tenantId, contact],
  );
  const longterm: string = ltRes.rows[0]?.summary ?? '';

  // 中期：未并入长期（folded=false）的近期日 summary 拼接
  const midRes = await pool.query(
    `SELECT summary FROM zenithjoy.cs_memory_daily
      WHERE tenant_id = $1 AND contact = $2 AND folded = false
      ORDER BY summary_day ASC`,
    [tenantId, contact],
  );
  const mid: string = (midRes.rows as { summary: string }[])
    .map((r) => r.summary)
    .join('\n\n');

  // 短期：最近 N 条原文滑窗（最旧→最新）
  const shortRes = await pool.query(
    `SELECT role, text FROM zenithjoy.cs_memory_messages
      WHERE tenant_id = $1 AND contact = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [tenantId, contact, shortTermLimit()],
  );
  const short: ChatLine[] = (shortRes.rows as ChatLine[])
    .map((r) => ({ role: r.role, text: r.text }))
    .reverse();

  return { context: { longterm, mid, short }, assembled: assembleContext(longterm, mid, short) };
}

// ─── 3) runDailyConsolidation：触发日收尾（当天短期→中期；跨天中期→并入长期）──

export async function runDailyConsolidation(input: {
  tenantId: string;
  contact: string;
  day?: string;
}): Promise<{ daily_generated: boolean; folded: boolean; day: string }> {
  const tenantId = (input.tenantId || '').trim();
  if (!tenantId) throw new MissingTenantError();
  const contact = input.contact;
  const day = normalizeDay(input.day);

  // (A) 当天短期消息 → 生成/更新中期 summary（空天不写空中期）
  const msgRes = await pool.query(
    `SELECT role, text FROM zenithjoy.cs_memory_messages
      WHERE tenant_id = $1 AND contact = $2 AND msg_day = $3::date
      ORDER BY created_at ASC, id ASC`,
    [tenantId, contact, day],
  );
  const todays = msgRes.rows as ChatLine[];

  let daily_generated = false;
  if (todays.length > 0) {
    const summary = await summarizeDay(todays, day);
    await pool.query(
      `INSERT INTO zenithjoy.cs_memory_daily (tenant_id, contact, summary_day, summary, folded, updated_at)
       VALUES ($1, $2, $3::date, $4, false, now())
       ON CONFLICT (tenant_id, contact, summary_day)
       DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()`,
      [tenantId, contact, day, summary],
    );
    daily_generated = true;
  }

  // (B) 跨天：把早于 day 且未 folded 的中期 summary 并入长期（融合压缩）
  const foldRes = await pool.query(
    `SELECT to_char(summary_day, 'YYYY-MM-DD') AS summary_day, summary
       FROM zenithjoy.cs_memory_daily
      WHERE tenant_id = $1 AND contact = $2 AND folded = false AND summary_day < $3::date
      ORDER BY summary_day ASC`,
    [tenantId, contact, day],
  );
  const toFold = foldRes.rows as { summary_day: string; summary: string }[];

  let folded = false;
  if (toFold.length > 0) {
    const ltRes = await pool.query(
      `SELECT summary FROM zenithjoy.cs_memory_longterm
        WHERE tenant_id = $1 AND contact = $2`,
      [tenantId, contact],
    );
    const oldLong: string = ltRes.rows[0]?.summary ?? '';
    const mergedSummary = await mergeLongterm(oldLong, toFold);
    const mergedThroughDay = toFold[toFold.length - 1].summary_day;

    await pool.query(
      `INSERT INTO zenithjoy.cs_memory_longterm (tenant_id, contact, summary, merged_through_day, updated_at)
       VALUES ($1, $2, $3, $4::date, now())
       ON CONFLICT (tenant_id, contact)
       DO UPDATE SET summary = EXCLUDED.summary,
                     merged_through_day = EXCLUDED.merged_through_day,
                     updated_at = now()`,
      [tenantId, contact, mergedSummary, mergedThroughDay],
    );

    await pool.query(
      `UPDATE zenithjoy.cs_memory_daily SET folded = true, updated_at = now()
        WHERE tenant_id = $1 AND contact = $2 AND folded = false AND summary_day < $3::date`,
      [tenantId, contact, day],
    );
    folded = true;
  }

  return { daily_generated, folded, day };
}
