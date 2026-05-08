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

// ─── 营销画像 + 对话历史拼 prompt ──────────────────────────────────────────────

function buildChatPrompt(
  content: string,
  history: FeishuRecord[],
  profile?: Record<string, unknown>,
): string {
  const profileLines: string[] = [];
  if (profile) {
    const industry = profile['行业'];
    const audience = profile['受众'];
    const hook = profile['钩子文案'];
    if (industry) profileLines.push(`行业: ${industry}`);
    if (audience) profileLines.push(`受众: ${audience}`);
    if (hook) profileLines.push(`钩子文案: ${hook}`);
  }

  const historyLines: string[] = [];
  for (const rec of history.slice(-10)) {
    const said = rec.fields?.['客户原话'];
    const replied = rec.fields?.['AI 草稿'];
    if (said) historyLines.push(`客户: ${String(said).slice(0, 200)}`);
    if (replied) historyLines.push(`我: ${String(replied).slice(0, 200)}`);
  }

  const profileBlock =
    profileLines.length > 0 ? `营销画像\n${profileLines.join('\n')}\n\n` : '';
  const historyBlock =
    historyLines.length > 0
      ? `最近对话历史（最旧→最新）\n${historyLines.join('\n')}\n\n`
      : '';

  return [
    '你是一名亲切、专业的私域客服助理，请用简体中文为以下客户消息生成一段简短自然的回复草稿（≤120 字），不要寒暄过度，直奔主题。',
    profileBlock,
    historyBlock,
    `客户最新消息: ${content}`,
    '回复草稿:',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export interface GenerateChatDraftParams {
  sender: string;
  wechat_id: string;
  content: string;
}

export interface GenerateChatDraftSuccess {
  ok: true;
  status: 'pending_review';
  task_id: string;
  draft_id: string;
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
  const { sender, wechat_id, content } = params;

  // 1) 校验 sender 在飞书"客户档案"表名单内
  let customers: FeishuRecord[] = [];
  try {
    customers = await searchTable(getCustomerTableId(), sender);
  } catch (err) {
    // 飞书 search 失败：thin 阶段当作"名单外"处理（fail-safe — 宁愿不生成也不误生成）
    console.warn('[wechat-draft] 飞书"客户档案"search 失败，按名单外处理:', err);
    return { ok: false, reason: 'not_in_whitelist' };
  }
  if (!customers || customers.length === 0) {
    return { ok: false, reason: 'not_in_whitelist' };
  }

  // 2) 拼对话历史（最近 10 轮）+ 营销画像
  let history: FeishuRecord[] = [];
  try {
    history = await searchTable(getInteractionTableId(), sender);
  } catch (err) {
    console.warn('[wechat-draft] 互动记录历史读取失败，跳过历史拼接:', err);
    history = [];
  }

  let profile: Record<string, unknown> | undefined;
  if (getProfileTableId()) {
    try {
      const profiles = await searchTable(getProfileTableId());
      if (profiles && profiles.length > 0) {
        profile = profiles[0].fields as Record<string, unknown>;
      }
    } catch (err) {
      console.warn('[wechat-draft] 营销画像读取失败，跳过:', err);
    }
  }

  const prompt = buildChatPrompt(content, history, profile);

  // 3) 调 OpenRouter DeepSeek
  let aiContent = '';
  let aiError: string | null = null;
  try {
    const result = await callOpenRouter({
      prompt,
      model: 'deepseek/deepseek-chat',
      request_purpose: 'wechat_chat_draft',
    });
    aiContent = (result.content || '').trim();
    if (!aiContent) {
      aiError = 'OpenRouter 返回空文本';
      aiContent = FAIL_PLACEHOLDER;
    }
  } catch (err) {
    aiError = err instanceof Error ? err.message : String(err);
    aiContent = FAIL_PLACEHOLDER;
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

  return {
    ok: true,
    status: 'pending_review',
    task_id: taskId,
    draft_id: draftId,
  };
}
