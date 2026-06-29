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
import type { BusinessKB, ChatMessage, ContactFact, ContactMemory, Persona } from './wechat/types';
import { retrieveRelevantKB } from './wechat/business-kb';
import { getPersona, getBusinessKB, getAutoAgentConfig } from './wechat/cs-config-store';
import { getCSConfigByAgentId, resolveCsWechatIdByAgentId } from './wechat/cs-account-config-store';
import {
  decideReplyRoute,
  withinBusinessHours,
  nowMinutesLocal,
  ROUTE_AUTO,
  ROUTE_REVIEW,
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
   * 在缺租户上下文时已 4xx 拒绝、绝不调到这里；带租户时透传进来，写入归属当前租户 agent。
   * 向后兼容既有非租户 caller（如服务级集成测试）→ optional，不破坏既有行为。
   */
  tenant_id?: string;
  /**
   * 'review'（默认）= A 路线审核台：只写飞书/DB pending_review，不回 reply。
   * 'auto' = 无审批自动回模式：受 getAutoAgentConfig 控制（C1 接线）——读总开关/营业时间/
   *          daily_limit + 查飞书白名单 → 按 decideReplyRoute 真值表分流：
   *            route=auto          → 生成 + 返回 reply（listener 真发）
   *            route=review        → 总开关 OFF（监控态）：仍生成草稿写飞书 pending_review，不返回 reply
   *            route=pending_human → 名单外 / 超 daily_limit：不生成不发，名单外返回 not_in_whitelist
   *            route=skip_offhours → 营业时间外：不返回 reply
   *          AI 失败时 reply 为 undefined（listener 跳过不发占位）。
   */
  mode?: 'auto' | 'review';
  /**
   * 测试 / 调用方可注入「当前分钟数」（当天 0–1439）做营业时间判定，避开真实时钟漂移。
   * 缺省 → 用本地时钟（nowMinutesLocal）。
   */
  now_minutes?: number;
  /**
   * 该联系人当天已自动回次数（daily_limit 判定用）。缺省 0。
   * thin 阶段由调用方/上层统计传入；服务端不在此查 DB（保持纯函数式决策可测）。
   */
  daily_count?: number;
  /**
   * 客户机 agent 身份。带上时，中台优先按【该客服自己那份配置】(每客服 wechat_cs_account_config)
   * 判白名单/人设/开关——每客户独立、改一个不动别人；解不到才回落旧的全局/飞书逻辑（向后兼容）。
   */
  agent_id?: string;
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
  const { sender, wechat_id, content, mode = 'review', tenant_id, agent_id } = params;

  // 每客服配置（本地 DB = 引擎，决策 dd320e56）：带 agent_id 时优先用【这台机自己那份配置】
  // 判白名单/人设/开关——每客户独立、改一个不动别人。解不到 → null，回落旧的飞书/全局逻辑（向后兼容）。
  const csConfig = agent_id ? await getCSConfigByAgentId(agent_id) : null;
  // S3 客服工作汇总：解析「处理本消息的客服微信号」给 in/out 落库盖身份章。
  // 优先用已配过的 csConfig.wechat_id；未配但已绑 PC → 经 service_agents 解出绑定的 wechat_id。
  // 解不到（无 agent_id / 未绑定）→ null：消息照常落库，只是不计入任何客服统计、不串台。
  const csWechatId: string | null =
    csConfig?.wechat_id ?? (agent_id ? await resolveCsWechatIdByAgentId(agent_id) : null);

  // 多租户隔离 scope：路由已保证带租户才会调到这里（缺租户在路由层 4xx 拦截）。
  // 写入归属当前租户：以 tenant scope 留痕，确保草稿入库可追溯到租户，不串到其它租户。
  console.info(
    `[wechat-draft] generateChatDraft tenant_scope=${tenant_id ?? '<none>'} sender=${sender}`,
  );

  // 1) 白名单校验 —— 两种模式都查飞书"客户档案"名单（C1 修复：auto 不再无条件跳过）。
  //    名单成员关系是后续路由真值表的入参（名单外 → pending_human，绝不自动回陌生人）。
  let inWhitelist = false;
  if (csConfig) {
    // 每客服白名单（一键配置/前台填，将来飞书 sync 进来）—— sender 在该客服自己名单内才算客户。
    inWhitelist = Array.isArray(csConfig.whitelist) && csConfig.whitelist.includes(sender);
  } else {
    let customers: FeishuRecord[] = [];
    try {
      customers = await searchTable(getCustomerTableId(), sender);
    } catch (err) {
      console.warn('[wechat-draft] 飞书"客户档案"search 失败，按名单外处理:', err);
      customers = [];
    }
    inWhitelist = Boolean(customers && customers.length > 0);
  }

  // review 模式（A 路线审核台）保持原契约：名单外直接拒，不生成不入库。
  if (mode !== 'auto' && !inWhitelist) {
    return { ok: false, reason: 'not_in_whitelist' };
  }

  // 1b) auto 模式（C1 接线核心）：读自动代理配置 → 按真值表分流。
  //     决策真正生效点在此（不再让 listen_chat 无条件全员回）。
  //     - route=pending_human 且名单外 → 立即拒（not_in_whitelist），不烧 LLM、不入库草稿。
  //     - route=skip_offhours / 超额 pending_human → 不返回 reply，也不生成（省 LLM），仅返回监控态。
  //     - route=review（总开关 OFF=监控态）→ 继续生成草稿写 pending_review，但不返回 reply。
  //     - route=auto → 继续生成 + 返回 reply（真发）。
  let autoShouldReturnReply = false;
  if (mode === 'auto') {
    // 每客服配置在册 → 用这台机自己那份的开关/营业时间/日上限；否则回落全局。
    const cfg = csConfig
      ? {
          auto_agent_enabled: csConfig.auto_agent_enabled,
          business_hours_start: csConfig.business_hours_start,
          business_hours_end: csConfig.business_hours_end,
          daily_limit: csConfig.daily_limit,
        }
      : await getAutoAgentConfig();
    let businessHoursOk = true;
    try {
      const nowMin = params.now_minutes ?? nowMinutesLocal();
      businessHoursOk = withinBusinessHours(
        cfg.business_hours_start,
        cfg.business_hours_end,
        nowMin,
      );
    } catch (err) {
      // 营业时间格式脏（UI 漏校验）→ 不崩主链路，按"营业中"处理但记日志（保守可回）。
      console.warn('[wechat-draft] 营业时间格式非法，按营业中处理:', err);
      businessHoursOk = true;
    }
    const route = decideReplyRoute(
      inWhitelist,
      businessHoursOk,
      cfg.auto_agent_enabled,
      params.daily_count ?? 0,
      cfg.daily_limit,
    );
    console.info(
      `[wechat-draft] auto route=${route} inWhitelist=${inWhitelist} ` +
        `enabled=${cfg.auto_agent_enabled} businessHoursOk=${businessHoursOk}`,
    );

    if (!inWhitelist && cfg.auto_agent_enabled) {
      // 名单外 + 开关 ON → pending_human：不生成不发，返回 not_in_whitelist（上层记 pending_human）。
      return { ok: false, reason: 'not_in_whitelist' };
    }
    if (route !== ROUTE_AUTO && route !== ROUTE_REVIEW) {
      // skip_offhours / 超 daily_limit 的 pending_human：不返回 reply，不生成草稿（省 LLM），监控态返回。
      return { ok: true, status: 'pending_review', task_id: crypto.randomUUID(), draft_id: '' };
    }
    // route=auto → 真发；route=review（监控态）→ 生成草稿但不返回 reply。
    autoShouldReturnReply = route === ROUTE_AUTO;
  }

  // 2) 三层记忆 + 人设 + 企业知识库 → 上下文装配（替代旧的"飞书取最近10轮+营销画像"）
  const contactKey = wechat_id || sender;
  try {
    await appendMessage(contactKey, sender, 'in', content, csWechatId);
  } catch (err) {
    console.warn('[wechat-draft] 写入站消息失败（不影响生成）:', err);
  }
  // 接缝 #1：同一条 in 盖客服身份章落到被 stats 聚合的 cs_memory_messages（解不到落 NULL）。
  await stampCsMemory(tenant_id, sender, 'in', content, csWechatId);

  // IA 重设计刀1（反转 PR#940）：AI 回复读【每号完整 persona + 每号 business_kb】（每号独立人设+知识库）。
  //   - 带 agent_id 解到该号配置(csConfig) → persona 全套 style + self_name + business_kb 全用【这个号自己的】。
  //   - csConfig 缺失（无 agent_id / 未配）→ 回落全局 getPersona()/getBusinessKB()（向后兼容）。
  //   - csConfig 命中但个别字段/整份 business_kb 为空（新号没填全）→ 该处回落全局，保证回复不退化。
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

  // 3) 调 OpenRouter DeepSeek（带人设 system + temperature；回复已在 openrouter 内剥思考块）
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
      aiContent = FAIL_PLACEHOLDER;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    aiContent = FAIL_PLACEHOLDER;
  }

  // 成功生成才记入"我方回复"短期记忆 + 触发固化（失败不污染记忆）
  if (!aiError) {
    try {
      await appendMessage(contactKey, sender, 'out', aiContent, csWechatId);
      await consolidate(contactKey);
    } catch (err) {
      console.warn('[wechat-draft] 写出站消息/固化失败（不影响回复）:', err);
    }
    // 接缝 #1：同一条 out 盖客服身份章落到被 stats 聚合的 cs_memory_messages（LLM 成功才有 out）。
    await stampCsMemory(tenant_id, sender, 'out', aiContent, csWechatId);
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

  // 无审批自动回 —— 仅 route=auto（autoShouldReturnReply）且 AI 成功才回 reply 文本；
  // AI 失败（aiContent=FAIL_PLACEHOLDER）reply 留 undefined，listener 检测到 undefined 即跳过不发，
  // 绝不把占位文案发给客户。route=review（监控态）/ mode:'review'（默认）永不带 reply。
  const reply = autoShouldReturnReply && !aiError ? aiContent : undefined;

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
