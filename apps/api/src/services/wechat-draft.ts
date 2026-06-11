/**
 * apps/api/src/services/wechat-draft.ts — Path 4 Sprint 1 ws3
 *
 * 私聊回复草稿生成器（A 路线护栏起点）：
 *   1) 校验 sender 在飞书"客户档案"表名单内（不在则拒）
 *   2) 拼对话历史（最近 10 轮，从飞书"互动记录"表读）+ 营销画像 prompt
 *   3) 调 OpenRouter DeepSeek 生成 AI 草稿
 *   4) 写飞书"互动记录"表：状态 pending_review，approval_source NULL（A 路线起点）
 *   5) 写 DB wechat_publish_task：type='chat'，approval_status='pending_review'
 *
 * 失败处理：OpenRouter 5xx / timeout → 飞书写"AI 生成失败"占位 + pending_review
 *
 * 约束：
 *   - approval_status 严禁 'approved'（防作弊点 A 路线护栏）
 *   - approval_source 在 ws3 阶段必须 NULL（系统不能自批）
 */

import crypto from 'node:crypto';
import axios from 'axios';
import pool from '../db/connection';
import { callOpenRouter } from '../llm/openrouter';
import type { ChatMessage, ContactFact, ContactMemory, Persona } from './wechat/types';
import { retrieveRelevantKB } from './wechat/business-kb';
import { getPersona, getBusinessKB } from './wechat/cs-config-store';
import {
  appendMessage,
  consolidate,
  getContactMemory,
  getShortTerm,
} from './wechat/contact-memory';
import { assembleChatContext } from './wechat/context-assembler';

// ─── 客服回复 LLM 配置：走 ToAPI deepseek-v4-flash（OpenAI 兼容 /chat/completions）──
//
// deepseek-v4-flash 是「推理模型」：思考走独立字段 reasoning_content（已在 openrouter.ts 丢弃），
// 答案在 content。推理会先吃 token，故 max_tokens 必须给足，否则 content 会被截成空串 → 回空。
//
// 端点/模型可被 ENV 覆盖；apiKey 走 TOAPI_API_KEY（1Password「ToAPI」条目，部署机 ENV 必须有）。
const CS_LLM = {
  model: process.env.WECHAT_CS_MODEL || 'deepseek-v4-flash',
  baseUrl: process.env.TOAPI_BASE_URL || 'https://toapis.com/v1/chat/completions',
  apiKey: process.env.TOAPI_API_KEY,
  maxTokens: Number(process.env.WECHAT_CS_MAX_TOKENS) || 2000, // 推理吃 token，给足防 content 被截空
};

// ─── 飞书 Bitable 配置（从 ENV 读，CI 用占位值 mock）────────────────────────────

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

function getFeishuAppId(): string {
  return process.env.FEISHU_APP_ID || '';
}
function getFeishuAppSecret(): string {
  return process.env.FEISHU_APP_SECRET || '';
}
function getAppToken(): string {
  return (
    process.env.FEISHU_TEST_APP_TOKEN ||
    process.env.FEISHU_PATH4_APP_TOKEN ||
    ''
  );
}
function getCustomerTableId(): string {
  return process.env.FEISHU_CUSTOMER_TABLE_ID || '';
}
function getInteractionTableId(): string {
  return process.env.FEISHU_INTERACTION_TABLE_ID || '';
}
function getProfileTableId(): string {
  return process.env.FEISHU_PROFILE_TABLE_ID || '';
}
function getScheduleTableId(): string {
  return process.env.FEISHU_SCHEDULE_TABLE_ID || '';
}

// ─── 飞书 Token 缓存（5 分钟内复用，单调用链内只取一次）────────────────────────

let cachedToken: { value: string; expireAt: number } | null = null;

/** 测试用：清掉 token 缓存，让每个 it 块从干净状态起 */
export function _resetFeishuTokenCache(): void {
  cachedToken = null;
}

async function getFeishuTenantToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expireAt > now + 60_000) {
    return cachedToken.value;
  }
  const resp = await axios.post<{
    code: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  }>(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: getFeishuAppId(),
    app_secret: getFeishuAppSecret(),
  });
  if (resp.data.code !== 0 || !resp.data.tenant_access_token) {
    throw new Error(
      `飞书获取 Token 失败: code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
    );
  }
  cachedToken = {
    value: resp.data.tenant_access_token,
    expireAt: now + (resp.data.expire ?? 7000) * 1000,
  };
  return resp.data.tenant_access_token;
}

// ─── 飞书 Bitable 通用调用 ────────────────────────────────────────────────────

interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface FeishuSearchResp {
  code: number;
  msg?: string;
  data?: { items?: FeishuRecord[]; has_more?: boolean };
}

interface FeishuCreateRecordResp {
  code: number;
  msg?: string;
  data?: { record?: FeishuRecord };
}

async function searchTable(
  tableId: string,
  customerName?: string,
  pageSize = 50,
): Promise<FeishuRecord[]> {
  const token = await getFeishuTenantToken();
  const url = `${FEISHU_API_BASE}/bitable/v1/apps/${getAppToken()}/tables/${tableId}/records/search`;
  const conditions: Array<Record<string, unknown>> = [];
  if (customerName) {
    conditions.push({ field_name: '客户名', operator: 'is', value: [customerName] });
  }
  const body: Record<string, unknown> = { page_size: pageSize };
  if (conditions.length > 0) {
    body.filter = { conjunction: 'and', conditions };
  }
  const resp = await axios.post<FeishuSearchResp>(url, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.data.code !== 0) {
    throw new Error(
      `飞书 search ${tableId} 失败: code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
    );
  }
  return resp.data.data?.items ?? [];
}

async function createRecord(
  tableId: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const token = await getFeishuTenantToken();
  const url = `${FEISHU_API_BASE}/bitable/v1/apps/${getAppToken()}/tables/${tableId}/records`;
  const resp = await axios.post<FeishuCreateRecordResp>(
    url,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (resp.data.code !== 0) {
    throw new Error(
      `飞书 create ${tableId} 失败: code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
    );
  }
  return resp.data.data?.record?.record_id ?? '';
}

// ─── 回复清洗（人设禁用词兜底；剥思考块已在 openrouter 内做）────────────────────

function sanitizeReply(text: string, persona: Persona): string {
  let out = text;
  for (const phrase of persona.banned_phrases || []) {
    if (phrase) out = out.split(phrase).join('');
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export interface GenerateChatDraftParams {
  sender: string;
  wechat_id: string;
  content: string;
  /**
   * 'review'（默认）= A 路线审核台：只写飞书/DB pending_review，不回 reply。
   * 'auto' = 隐形自动回模式：同样写审核台入库，额外把生成文案作为 reply 返回，
   *          listener 拿 reply 直接用本人微信号发出去（AI 失败时 reply 为 undefined，listener 跳过不发占位）。
   */
  mode?: 'auto' | 'review';
}

export interface GenerateChatDraftSuccess {
  ok: true;
  status: 'pending_review';
  task_id: string;
  draft_id: string;
  /** mode:'auto' 且 AI 成功时为生成文案；mode:'review' 或 AI 失败时 undefined。 */
  reply?: string;
}

export interface GenerateChatDraftRejected {
  ok: false;
  reason: 'not_in_whitelist';
}

export type GenerateChatDraftResult =
  | GenerateChatDraftSuccess
  | GenerateChatDraftRejected;

const FAIL_PLACEHOLDER = 'AI 生成失败（请人审决定是否重试）';

export async function generateChatDraft(
  params: GenerateChatDraftParams,
): Promise<GenerateChatDraftResult> {
  const { sender, wechat_id, content, mode = 'review' } = params;

  // 1) 白名单校验 —— mode='auto'（listen_chat 全员自动回）时跳过，review 模式才查飞书名单。
  if (mode !== 'auto') {
    let customers: FeishuRecord[] = [];
    try {
      customers = await searchTable(getCustomerTableId(), sender);
    } catch (err) {
      console.warn('[wechat-draft] 飞书"客户档案"search 失败，按名单外处理:', err);
      return { ok: false, reason: 'not_in_whitelist' };
    }
    if (!customers || customers.length === 0) {
      return { ok: false, reason: 'not_in_whitelist' };
    }
  }

  // 2) 三层记忆 + 人设 + 企业知识库 → 上下文装配（替代旧的"飞书取最近10轮+营销画像"）
  const contactKey = wechat_id || sender;
  try {
    await appendMessage(contactKey, sender, 'in', content);
  } catch (err) {
    console.warn('[wechat-draft] 写入站消息失败（不影响生成）:', err);
  }

  const persona = await getPersona();
  const kb = await getBusinessKB();
  let shortTerm: ChatMessage[] = [];
  let memory: ContactMemory = { summary: '', facts: [] as ContactFact[] };
  try {
    [shortTerm, memory] = await Promise.all([
      getShortTerm(contactKey),
      getContactMemory(contactKey),
    ]);
  } catch (err) {
    console.warn('[wechat-draft] 读取客户记忆失败，降级为无记忆:', err);
  }
  const kbHits = retrieveRelevantKB(content, kb);
  const { system, user } = assembleChatContext({
    message: content,
    persona,
    kb,
    kbHits,
    shortTerm,
    memory,
  });

  // 3) 调 OpenRouter DeepSeek（带人设 system + temperature；回复已在 openrouter 内剥思考块）
  let aiContent = '';
  let aiError: string | null = null;
  try {
    const result = await callOpenRouter({
      system,
      prompt: user,
      temperature: 0.8,
      model: CS_LLM.model,
      baseUrl: CS_LLM.baseUrl,
      apiKey: CS_LLM.apiKey,
      maxTokens: CS_LLM.maxTokens,
      purpose: 'wechat_chat_draft',
    });
    aiContent = sanitizeReply((result.content || '').trim(), persona);
    if (!aiContent) {
      aiError = `${CS_LLM.model} 返回空文本`;
      aiContent = FAIL_PLACEHOLDER;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    aiContent = FAIL_PLACEHOLDER;
  }

  // 成功生成才记入"我方回复"短期记忆 + 触发固化（失败不污染记忆）
  if (!aiError) {
    try {
      await appendMessage(contactKey, sender, 'out', aiContent);
      await consolidate(contactKey);
    } catch (err) {
      console.warn('[wechat-draft] 写出站消息/固化失败（不影响回复）:', err);
    }
  }

  // 4) 写飞书"互动记录"表（pending_review，approval_source NULL — A 路线护栏起点）
  const generatedAt = Date.now();
  let draftId = '';
  try {
    draftId = await createRecord(getInteractionTableId(), {
      客户名: sender,
      客户原话: content,
      'AI 草稿': aiContent,
      生成时间: generatedAt,
      状态: 'pending_review',
    });
  } catch (err) {
    console.warn('[wechat-draft] 写飞书"互动记录"失败:', err);
    // thin 阶段：飞书写失败仍保留 DB 入库（人审在 DB 看得到）
  }

  // 5) 写 DB wechat_publish_task：type='chat'，approval_status='pending_review'，approval_source NULL
  const taskId = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO wechat_publish_task
        (task_id, platform, type, target_user, content_draft, approval_status, approval_source, feishu_record_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        taskId,
        'wechat_personal',
        'chat',
        wechat_id,
        aiContent,
        'pending_review',
        null, // ws3 阶段 approval_source 必须 NULL
        draftId || null,
      ],
    );
  } catch (err) {
    console.warn('[wechat-draft] DB INSERT wechat_publish_task 失败:', err);
  }

  if (aiError) {
    console.warn('[wechat-draft] AI 草稿生成失败 fallback 占位:', aiError);
  }

  // mode:'auto' 隐形自动回 —— AI 成功才回 reply 文本；AI 失败（aiContent=FAIL_PLACEHOLDER）reply 留 undefined，
  // listener 检测到 undefined 即跳过不发，绝不把占位文案发给客户。mode:'review'（默认）永不带 reply。
  const reply = mode === 'auto' && !aiError ? aiContent : undefined;

  return {
    ok: true,
    status: 'pending_review',
    task_id: taskId,
    draft_id: draftId,
    ...(reply !== undefined ? { reply } : {}),
  };
}

// ─── ws4: generateMomentDraft（朋友圈文案草稿）────────────────────────────────

export interface GenerateMomentDraftParams {
  customer: string;
}

export interface GenerateMomentDraftSuccess {
  ok: true;
  status: 'pending_review';
  task_id: string;
  draft_id: string;
}

export interface GenerateMomentDraftSkipped {
  ok: false;
  reason: 'profile_missing' | 'already_generated_today';
}

export type GenerateMomentDraftResult =
  | GenerateMomentDraftSuccess
  | GenerateMomentDraftSkipped;

function buildMomentPrompt(profile: {
  industry: string;
  audience: string;
  hook: string;
}): string {
  return [
    '你是一名熟悉私域营销的朋友圈文案写手，请根据以下营销画像写一段简短自然的朋友圈文案（≤120 字），不要过度推销。',
    '营销画像',
    `行业: ${profile.industry}`,
    `受众: ${profile.audience}`,
    `钩子文案: ${profile.hook}`,
    '',
    '朋友圈文案:',
  ].join('\n');
}

/**
 * 朋友圈文案草稿生成（thin 阶段 A 路线护栏起点）：
 *   1) 校验飞书"营销画像"对应客户 3 字段（行业 / 受众 / 钩子文案）齐全；任一缺失 → profile_missing
 *   2) 校验 DB wechat_publish_task type='moment' 当日（CURRENT_DATE）该客户是否已生成过 → already_generated_today
 *   3) 拼营销画像 3 字段 + 硬编码 prompt → 调 OpenRouter DeepSeek
 *   4) 写飞书"内容排期"表（status='pending_review'，approval_source 不写）
 *   5) 写 DB wechat_publish_task（type='moment', approval_status='pending_review',
 *      approval_source NULL — 不允许 system 自批）
 *
 * 失败处理：OpenRouter 5xx → 飞书排期写"AI 生成失败"占位，状态仍 pending_review（人审决定重试）。
 */
export async function generateMomentDraft(
  params: GenerateMomentDraftParams,
): Promise<GenerateMomentDraftResult> {
  const { customer } = params;

  // 1) 飞书"营销画像"表查 3 字段
  let profileRows: FeishuRecord[] = [];
  try {
    profileRows = await searchTable(getProfileTableId(), customer);
  } catch (err) {
    console.warn('[wechat-draft] 营销画像 search 失败，按 profile_missing 处理:', err);
    return { ok: false, reason: 'profile_missing' };
  }

  if (!profileRows || profileRows.length === 0) {
    return { ok: false, reason: 'profile_missing' };
  }

  const profileFields = profileRows[0].fields ?? {};
  const industry = String(profileFields['行业'] ?? '').trim();
  const audience = String(profileFields['受众'] ?? '').trim();
  const hook = String(profileFields['钩子文案'] ?? '').trim();
  if (!industry || !audience || !hook) {
    return { ok: false, reason: 'profile_missing' };
  }

  // 2) 当日去重（CURRENT_DATE 比对 created_at::date）
  try {
    const dupResult = await pool.query(
      `SELECT task_id FROM wechat_publish_task
        WHERE type = $1
          AND target_user = $2
          AND created_at::date = CURRENT_DATE
        LIMIT 1`,
      ['moment', customer],
    );
    if (dupResult.rows && dupResult.rows.length > 0) {
      return { ok: false, reason: 'already_generated_today' };
    }
  } catch (err) {
    // 当日去重 SELECT 失败时按"未生成过"放行（fail-open，避免飞书读完了卡住）
    console.warn('[wechat-draft] 当日去重 SELECT 失败，放行生成:', err);
  }

  // 3) 拼 prompt → 调 OpenRouter DeepSeek
  const prompt = buildMomentPrompt({ industry, audience, hook });
  let aiContent = '';
  let aiError: string | null = null;
  try {
    const result = await callOpenRouter({
      prompt,
      model: CS_LLM.model,
      baseUrl: CS_LLM.baseUrl,
      apiKey: CS_LLM.apiKey,
      maxTokens: CS_LLM.maxTokens,
      purpose: 'wechat_moment_draft',
    });
    aiContent = (result.content || '').trim();
    if (!aiContent) {
      aiError = `${CS_LLM.model} 返回空文本`;
      aiContent = FAIL_PLACEHOLDER;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    aiContent = FAIL_PLACEHOLDER;
  }

  // 4) 写飞书"内容排期"表（pending_review，不写 approval_source — A 路线护栏起点）
  const generatedAt = Date.now();
  let draftId = '';
  try {
    draftId = await createRecord(getScheduleTableId(), {
      客户名: customer,
      文案: aiContent,
      生成时间: generatedAt,
      状态: 'pending_review',
    });
  } catch (err) {
    console.warn('[wechat-draft] 写飞书"内容排期"失败:', err);
  }

  // 5) 写 DB wechat_publish_task：type='moment'，approval_status='pending_review'，approval_source NULL
  const taskId = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO wechat_publish_task
        (task_id, platform, type, target_user, content_draft, approval_status, approval_source, feishu_record_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        taskId,
        'wechat_personal',
        'moment',
        customer,
        aiContent,
        'pending_review',
        null, // ws4 阶段 approval_source 必须 NULL
        draftId || null,
      ],
    );
  } catch (err) {
    console.warn('[wechat-draft] DB INSERT wechat_publish_task (moment) 失败:', err);
  }

  if (aiError) {
    console.warn('[wechat-draft] AI 朋友圈草稿生成失败 fallback 占位:', aiError);
  }

  return {
    ok: true,
    status: 'pending_review',
    task_id: taskId,
    draft_id: draftId,
  };
}
