/**
 * apps/api/src/services/wechat-draft.ts — Line04 去飞书 + 个人私聊 AI 自动直发（第一刀）
 *
 * 私聊回复（generateChatDraft，已彻底去飞书 / 自动直发）：
 *   1) gating（本地，blacklist 主模型）：群消息 → 不回；CRM 标黑 → 不回；个人未标黑 → 自动直发
 *   2) 三层记忆（DB wechat_messages）+ 每号人设/知识库 → 上下文装配
 *   3) 调 gpt-5.4-mini（WECHAT_CS_MODEL）生成回复
 *   4) route=send 且 AI 成功 → 直接返回 reply 文本（agent 立即 UIA 发送，不经任何审核）
 *
 * 去飞书（用户拍板 2026-06-30）：白名单/黑名单只查本地（wechat_cs_account_config + crm_customers），
 * 不再写飞书"互动记录"、不再落 DB pending_review、不再查飞书"客户档案"。
 *
 * 失败处理：AI 生成失败 → 中台 console.error 报红 + 结构化告警日志，**不返回 reply**
 * （绝不把"AI 生成失败"占位文案发给客户）；关键人微信通知留第二刀。
 *
 * 朋友圈（generateMomentDraft）仍在飞书"营销画像/内容排期"路径（Path4 Step4-5，本刀不动）。
 */

import crypto from 'node:crypto';
import axios from 'axios';
import pool from '../db/connection';
import { callOpenRouter } from '../llm/openrouter';
import type { BusinessKB, ChatMessage, ContactFact, ContactMemory, Persona } from './wechat/types';
import { retrieveRelevantKB } from './wechat/business-kb';
import { getPersona, getBusinessKB } from './wechat/cs-config-store';
import { getCSConfigByAgentId, resolveCsWechatIdByAgentId } from './wechat/cs-account-config-store';
import {
  decideAutoSendRoute,
  ROUTE_SEND,
  ROUTE_SKIP_GROUP,
} from './wechat/cs-route-decision';
import {
  appendMessage,
  consolidate,
  getContactMemory,
  getShortTerm,
} from './wechat/contact-memory';
import { appendTenantMessage } from './wechat/tenant-memory';
import { assembleChatContext } from './wechat/context-assembler';

// ─── 客服回复 LLM 配置：走 ToAPI deepseek-v3.2（OpenAI 兼容 /chat/completions）──
//
// 默认 deepseek-v3.2：非推理模型，~1.5s 出答案，比推理版 deepseek-v4-flash 快 4-8 倍且不烧
// reasoning token（v4-flash 思考走 reasoning_content、会先吃光 max_tokens 致 content 空+慢）。
// openrouter.ts 仍丢弃 reasoning_content 作防御：万一 ENV 切回推理模型也不会把思考漏给客户。
//
// 端点/模型可被 ENV 覆盖（WECHAT_CS_MODEL）；apiKey 走 TOAPI_API_KEY（1Password「ToAPI」条目，部署机 ENV 必须有）。
// 惰性读 env（调用时而非模块加载时）：保证测试 beforeAll 设的 env / 部署后改的 env 都生效，
// 不被 import 时机锁死。
function csLlm() {
  return {
    model: process.env.WECHAT_CS_MODEL || 'deepseek-v3.2',
    baseUrl: process.env.TOAPI_BASE_URL || 'https://toapis.com/v1/chat/completions',
    apiKey: process.env.TOAPI_API_KEY,
    maxTokens: Number(process.env.WECHAT_CS_MAX_TOKENS) || 2000,
  };
}

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

// ─── IA 重设计刀1：每号 persona / business_kb 优先，字段/整份缺失回落全局（兼容、不退化）──

/**
 * 每号 persona 优先：cs 命中的字段用 cs 的，空字段（含整份缺失）回落全局对应字段。
 * 这样新号还没填全的字段不会让回复退化，已填字段绝对用该号自己的（每号独立人设）。
 */
function mergePersonaPreferCs(cs: Partial<Persona> | undefined, global: Persona): Persona {
  if (!cs) return global;
  const pick = (v: string | undefined, fb: string) =>
    typeof v === 'string' && v.trim() ? v : fb;
  return {
    self_name: pick(cs.self_name, global.self_name),
    address_style: pick(cs.address_style, global.address_style),
    tone: pick(cs.tone, global.tone),
    sentence_style: pick(cs.sentence_style, global.sentence_style),
    use_emoji: pick(cs.use_emoji, global.use_emoji),
    banned_phrases:
      Array.isArray(cs.banned_phrases) && cs.banned_phrases.length
        ? cs.banned_phrases
        : global.banned_phrases,
    few_shot:
      Array.isArray(cs.few_shot) && cs.few_shot.length ? cs.few_shot : global.few_shot,
  };
}

/** 每号 business_kb 是否有实质内容（有 → 用每号；空 → 回落全局兜底）。 */
function csKbHasContent(kb: BusinessKB | undefined): boolean {
  if (!kb) return false;
  return Boolean(
    kb.company?.name?.trim() ||
      (Array.isArray(kb.products) && kb.products.length) ||
      (Array.isArray(kb.audience_segments) && kb.audience_segments.length) ||
      (Array.isArray(kb.qa_docs) && kb.qa_docs.length),
  );
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export interface GenerateChatDraftParams {
  sender: string;
  wechat_id: string;
  content: string;
  /**
   * 多租户隔离 scope：当前请求归属的租户。路由层（POST /api/wechat/draft-generate）
   * 在缺租户上下文时已 4xx 拒绝、绝不调到这里；带租户时透传进来用于本地黑名单查询。
   * 向后兼容既有非租户 caller（如服务级集成测试）→ optional，不破坏既有行为。
   */
  tenant_id?: string;
  /**
   * 'auto'（默认）= 自动直发：gating 通过 + AI 成功 → 直接返回 reply（agent 立即 UIA 发，不经审核）。
   * 'review' = 监控态：仍跑 gating，但不生成 / 不返回 reply（去飞书后无审核台，仅留作不直发的开关）。
   */
  mode?: 'auto' | 'review';
  /**
   * 是否群聊消息。群聊 → 绝不自动回（decideAutoSendRoute → skip_group）。
   * agent 端读会话右上角标题 "(人数)" 判群后传入；缺省 false（按个人私聊处理）。
   */
  is_group?: boolean;
  /**
   * 客户机 agent 身份。带上时优先用【该客服自己那份配置】(每客服 wechat_cs_account_config)
   * 的人设/知识库 + 解析该客服微信号查 per-cs 黑名单；解不到回落全局（向后兼容）。
   */
  agent_id?: string;
}

export interface GenerateChatDraftResult {
  ok: boolean;
  /**
   * sent     = route=send 且 AI 成功 → 带 reply（自动直发）
   * skipped  = 群消息 / 标黑 → 不回（带 skip_reason）
   * ai_failed= route=send 但 AI 生成失败 → 不带 reply（中台已报红）
   * monitor  = mode:'review' 监控态 → 不带 reply
   */
  status: 'sent' | 'skipped' | 'ai_failed' | 'monitor';
  task_id: string;
  /** 去飞书后恒为空串（保留字段形状，向后兼容既有 caller 读取）。 */
  draft_id: string;
  /** status:'skipped' 时说明跳过原因。 */
  skip_reason?: 'group' | 'blacklisted';
  /** 仅 status:'sent' 时为生成文案；其余一律 undefined（agent 检测到 undefined 即跳过不发）。 */
  reply?: string;
}

const FAIL_PLACEHOLDER = 'AI 生成失败（请人审决定是否重试）';

/**
 * 本地黑名单判定（去飞书，blacklist 主模型 SSOT）：
 *   1) per-客服机 接管 gate：zenithjoy.wechat_cs_account_config.blacklist（jsonb 数组，按客服微信号分行）
 *   2) 名册属性：zenithjoy.crm_customers.identity='blacklist'（与 config.blacklist 双向同步，多查一层防漏）
 * 任一命中 → 标黑（不回）。读类失败一律 console.warn 后按"未标黑"处理（fail-open，绝不因 DB 抖动漏回客户）。
 */
async function isContactBlacklisted(
  csWechatId: string | null,
  tenantId: string | undefined,
  sender: string,
): Promise<boolean> {
  if (csWechatId) {
    try {
      const { rows } = await pool.query(
        `SELECT blacklist FROM zenithjoy.wechat_cs_account_config WHERE wechat_id = $1`,
        [csWechatId],
      );
      const raw = rows?.[0]?.blacklist;
      const list: string[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return [];
              }
            })()
          : [];
      if (list.includes(sender)) return true;
    } catch (err) {
      console.warn('[wechat-draft] 读 per-cs 黑名单失败，按未标黑处理:', err);
    }
  }
  if (tenantId) {
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM zenithjoy.crm_customers
          WHERE tenant_id = $1 AND contact = $2 AND identity = 'blacklist' AND deleted_at IS NULL
          LIMIT 1`,
        [tenantId, sender],
      );
      if (rows && rows.length > 0) return true;
    } catch (err) {
      console.warn('[wechat-draft] 读 crm_customers 黑名单失败，按未标黑处理:', err);
    }
  }
  return false;
}

/**
 * 把一条 in/out 消息盖客服身份章落到被 stats 聚合的 zenithjoy.cs_memory_messages。
 * 接缝 #1：经身份解析链解出的 csWechatId 盖到该行；解不到 → null（不计入任何客服、不报错）。
 * 非致命：缺租户上下文 / DB 抖动一律 console.warn 吞掉，绝不阻塞草稿主链路。
 */
async function stampCsMemory(
  tenantId: string | undefined,
  contact: string,
  role: 'in' | 'out',
  text: string,
  csWechatId: string | null,
): Promise<void> {
  if (!tenantId) return; // 无租户上下文不盖章（既有非租户 caller 行为不变）
  try {
    await appendTenantMessage({ tenantId, contact, role, text, csWechatId });
  } catch (err) {
    console.warn('[wechat-draft] cs_memory 盖章落库失败（不影响生成）:', err);
  }
}

export async function generateChatDraft(
  params: GenerateChatDraftParams,
): Promise<GenerateChatDraftResult> {
  const { sender, wechat_id, content, mode = 'auto', tenant_id, agent_id, is_group = false } =
    params;

  // 每客服配置（本地 DB = 引擎，决策 dd320e56）：带 agent_id 时优先用【这台机自己那份配置】
  // 的人设/知识库 + 解析客服微信号查 per-cs 黑名单。解不到 → null，回落全局（向后兼容）。
  const csConfig = agent_id ? await getCSConfigByAgentId(agent_id) : null;
  // S3 客服工作汇总：解析「处理本消息的客服微信号」给 in/out 落库盖身份章 + 查 per-cs 黑名单。
  const csWechatId: string | null =
    csConfig?.wechat_id ?? (agent_id ? await resolveCsWechatIdByAgentId(agent_id) : null);

  console.info(
    `[wechat-draft] generateChatDraft tenant_scope=${tenant_id ?? '<none>'} sender=${sender} is_group=${is_group}`,
  );

  // 1) gating（去飞书 + blacklist 主模型，决策 2026-06-30）：群消息 → 不回；CRM 标黑 → 不回；
  //    个人未标黑 → 自动直发（默认全回）。白名单/黑名单只查本地，不再查飞书"客户档案"。
  const blacklisted = is_group ? false : await isContactBlacklisted(csWechatId, tenant_id, sender);
  const route = decideAutoSendRoute(Boolean(is_group), blacklisted);
  if (route !== ROUTE_SEND) {
    const skip_reason = route === ROUTE_SKIP_GROUP ? 'group' : 'blacklisted';
    console.info(`[wechat-draft] skip sender=${sender} reason=${skip_reason}（不自动回）`);
    return { ok: true, status: 'skipped', task_id: crypto.randomUUID(), draft_id: '', skip_reason };
  }

  // 监控态（mode:'review'）：去飞书后无审核台，仅作"不直发"的开关——不生成、不返回 reply。
  if (mode !== 'auto') {
    return { ok: true, status: 'monitor', task_id: crypto.randomUUID(), draft_id: '' };
  }

  // 2) 三层记忆（DB wechat_messages）+ 每号人设/知识库 → 上下文装配
  const contactKey = wechat_id || sender;
  try {
    await appendMessage(contactKey, sender, 'in', content, csWechatId);
  } catch (err) {
    console.warn('[wechat-draft] 写入站消息失败（不影响生成）:', err);
  }
  // 接缝 #1：同一条 in 盖客服身份章落到被 stats 聚合的 cs_memory_messages（解不到落 NULL）。
  await stampCsMemory(tenant_id, sender, 'in', content, csWechatId);

  // IA 重设计刀1（反转 PR#940）：AI 回复读【每号完整 persona + 每号 business_kb】（每号独立人设+知识库）。
  const globalPersona = await getPersona();
  const persona = mergePersonaPreferCs(csConfig?.persona, globalPersona);
  const kb: BusinessKB = csKbHasContent(csConfig?.business_kb)
    ? (csConfig!.business_kb as BusinessKB)
    : await getBusinessKB();
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

  // 3) 调 gpt-5.4-mini（WECHAT_CS_MODEL；回复已在 openrouter 内剥思考块）
  let aiContent = '';
  let aiError: string | null = null;
  const cs = csLlm();
  try {
    const result = await callOpenRouter({
      system,
      prompt: user,
      temperature: 0.8,
      model: cs.model,
      baseUrl: cs.baseUrl,
      apiKey: cs.apiKey,
      maxTokens: cs.maxTokens,
      purpose: 'wechat_chat_draft',
    });
    aiContent = sanitizeReply((result.content || '').trim(), persona);
    if (!aiContent) {
      aiError = `${cs.model} 返回空文本`;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
  }

  const taskId = crypto.randomUUID();

  // 4) AI 失败 → 立即报红 + 结构化告警日志，**不返回 reply**（绝不把占位文案发给客户）。
  //    第一刀只做中台报红；微信通知关键人留第二刀（关键人身份层还没建）。
  if (aiError) {
    console.error(
      `[wechat-draft][ALARM] AI 生成失败 不自动回复 | ` +
        JSON.stringify({
          event: 'wechat_cs_ai_failed',
          tenant: tenant_id ?? null,
          cs_wechat_id: csWechatId,
          sender,
          model: cs.model,
          error: aiError,
        }),
    );
    return { ok: true, status: 'ai_failed', task_id: taskId, draft_id: '' };
  }

  // AI 成功 → 记入"我方回复"短期记忆 + 触发固化（盖客服身份章），然后直接返回 reply（自动直发）。
  try {
    await appendMessage(contactKey, sender, 'out', aiContent, csWechatId);
    await consolidate(contactKey);
  } catch (err) {
    console.warn('[wechat-draft] 写出站消息/固化失败（不影响回复）:', err);
  }
  await stampCsMemory(tenant_id, sender, 'out', aiContent, csWechatId);

  console.info(`[wechat-draft] auto-send sender=${sender} reply_len=${aiContent.length}`);
  return { ok: true, status: 'sent', task_id: taskId, draft_id: '', reply: aiContent };
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
      `SELECT task_id FROM zenithjoy.wechat_publish_task
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
  const cs = csLlm();
  try {
    const result = await callOpenRouter({
      prompt,
      model: cs.model,
      baseUrl: cs.baseUrl,
      apiKey: cs.apiKey,
      maxTokens: cs.maxTokens,
      purpose: 'wechat_moment_draft',
    });
    aiContent = (result.content || '').trim();
    if (!aiContent) {
      aiError = `${cs.model} 返回空文本`;
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
      `INSERT INTO zenithjoy.wechat_publish_task
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
