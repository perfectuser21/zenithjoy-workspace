/**
 * OpenRouter 封装（Path 4 ws1）
 *
 * - 默认 model: deepseek/deepseek-chat
 * - 调用前 INSERT llm_audit（成功/失败都写）
 * - OPENROUTER_FORCE_5XX=1 注入故障（仅 NODE_ENV in (test, development) 生效）
 * - CI=true → max_tokens cap 到 20（避免烧钱）
 * - 失败 5xx 重试 1 次，超时 30s
 */

import pool from '../db/connection';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek/deepseek-chat';
const DEFAULT_MAX_TOKENS = 1024;
const CI_MAX_TOKENS = 20;
const TIMEOUT_MS = 30_000;

export interface CallOpenRouterParams {
  prompt: string;
  model?: string;
  max_tokens?: number;
  request_purpose?: string;
}

export interface CallOpenRouterResult {
  content: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenRouterUsage;
}

function isFaultInjectionAllowed(): boolean {
  // 仅 NODE_ENV in (test, development) 允许 OPENROUTER_FORCE_5XX 故障注入
  // production 即使 env 设了也忽略（生产真调）
  const env = process.env.NODE_ENV;
  return env === 'test' || env === 'development';
}

function isCiMode(): boolean {
  return process.env.CI === 'true';
}

function capMaxTokens(requested: number | undefined): number {
  const base = requested ?? DEFAULT_MAX_TOKENS;
  if (isCiMode()) {
    return Math.min(base, CI_MAX_TOKENS);
  }
  return base;
}

function estimateCost(usage: OpenRouterUsage | undefined): number {
  if (!usage) return 0;
  if (typeof usage.cost === 'number') return usage.cost;
  // 兜底估算：deepseek-chat ~ $0.27/M input + $1.1/M output（2026 价格）
  const promptT = usage.prompt_tokens ?? 0;
  const compT = usage.completion_tokens ?? 0;
  return (promptT * 0.27 + compT * 1.1) / 1_000_000;
}

async function insertAudit(row: {
  provider: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost: number | null;
  request_purpose: string | null;
  error: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO llm_audit
        (provider, model, prompt_tokens, completion_tokens, cost, request_purpose, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.provider,
        row.model,
        row.prompt_tokens,
        row.completion_tokens,
        row.cost,
        row.request_purpose,
        row.error,
      ],
    );
  } catch (err) {
    // 审计写失败不阻塞主调用
    console.warn('[llm/openrouter] llm_audit INSERT 失败:', err);
  }
}

async function postOnce(
  body: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return resp;
  } finally {
    clearTimeout(t);
  }
}

export async function callOpenRouter(
  params: CallOpenRouterParams,
): Promise<CallOpenRouterResult> {
  const model = params.model || DEFAULT_MODEL;
  const max_tokens = capMaxTokens(params.max_tokens);
  const request_purpose = params.request_purpose ?? null;

  // 故障注入（仅 test/dev 生效）
  if (process.env.OPENROUTER_FORCE_5XX === '1' && isFaultInjectionAllowed()) {
    await insertAudit({
      provider: 'openrouter',
      model,
      prompt_tokens: null,
      completion_tokens: null,
      cost: null,
      request_purpose,
      error: 'simulated 5xx (OPENROUTER_FORCE_5XX=1)',
    });
    throw new Error('simulated 5xx (HTTP 503): OPENROUTER_FORCE_5XX=1');
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY 未配置（应 source ~/.credentials/openrouter.env）',
    );
  }

  const body = {
    model,
    messages: [{ role: 'user', content: params.prompt }],
    max_tokens,
  };

  let resp: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      resp = await postOnce(body, apiKey);
      if (resp.ok) break;
      // 5xx 重试一次
      if (resp.status >= 500 && resp.status < 600 && attempt === 1) {
        continue;
      }
      const text = await resp.text().catch(() => '');
      lastErr = new Error(`OpenRouter ${resp.status}: ${text}`);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === 2) break;
    }
  }

  if (!resp || !resp.ok) {
    const errMsg =
      lastErr instanceof Error
        ? lastErr.message
        : String(lastErr ?? 'unknown error');
    await insertAudit({
      provider: 'openrouter',
      model,
      prompt_tokens: null,
      completion_tokens: null,
      cost: null,
      request_purpose,
      error: errMsg,
    });
    throw new Error(`OpenRouter call failed: ${errMsg}`);
  }

  const data = (await resp.json()) as OpenRouterResponse;
  const content = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? {};
  const prompt_tokens = usage.prompt_tokens ?? 0;
  const completion_tokens = usage.completion_tokens ?? 0;
  const cost = estimateCost(usage);

  await insertAudit({
    provider: 'openrouter',
    model,
    prompt_tokens,
    completion_tokens,
    cost,
    request_purpose,
    error: null,
  });

  return { content, model, prompt_tokens, completion_tokens, cost };
}
