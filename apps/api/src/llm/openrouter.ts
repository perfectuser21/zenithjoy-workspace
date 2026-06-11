import pool from '../db/connection';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

export interface CallOpenRouterArgs {
  prompt: string;
  purpose: string;
  maxTokens?: number;
  model?: string;
  /** 可选 system 消息（人设 + 企业信息段）；不传则维持单 user 消息（向后兼容）。 */
  system?: string;
  /** 采样温度；不传则用 provider 默认。微信客服真人感建议 0.8。 */
  temperature?: number;
  /** 覆盖默认端点（OpenAI 兼容 /chat/completions 全 URL）。不传走 OpenRouter。
   *  传了即视为「自定义 provider」，此时 apiKey 必须显式提供，不回退 OPENROUTER_API_KEY。 */
  baseUrl?: string;
  /** 覆盖默认 API key。不传且未指定 baseUrl 时回退 OPENROUTER_API_KEY。 */
  apiKey?: string;
}

/**
 * 剥离模型输出里的"思考过程"，绝不让客户看到。
 * 处理 DeepSeek-R1 风格的 <think>...</think>（含多行 / 未闭合到结尾），
 * 以及开头的「思考：/分析：/让我想想」类前缀。任何场景都不该把推理漏给客户。
 */
export function stripThinking(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, ''); // 完整思考块
  out = out.replace(/<think>[\s\S]*$/gi, ''); // 未闭合到结尾的思考块
  out = out.replace(/^\s*(?:思考|分析|让我想想|让我先想想)\s*[:：][^\n]*\n+/i, ''); // 开头思考前缀行
  return out.trim();
}

export interface CallOpenRouterResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
}

function shouldForce5xx(): boolean {
  return process.env.OPENROUTER_FORCE_5XX === '1'
    && ['test', 'development'].includes(process.env.NODE_ENV || '');
}

function clampMaxTokens(requested: number | undefined): number {
  const base = requested ?? 1000;
  if (process.env.CI === 'true') return Math.min(base, 20); // CI cap: max_tokens=20
  return base;
}

async function writeAudit(row: {
  purpose: string; model: string;
  prompt_tokens: number; completion_tokens: number; total_tokens: number;
  cost_usd: number; duration_ms: number; success: boolean; error?: string;
}) {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.llm_audit
         (request_purpose, model, prompt_tokens, completion_tokens, total_tokens,
          cost_usd, duration_ms, success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.purpose, row.model, row.prompt_tokens, row.completion_tokens,
       row.total_tokens, row.cost_usd, row.duration_ms, row.success, row.error ?? null]
    );
  } catch (e) {
    console.warn('[openrouter] audit insert failed:', (e as Error).message);
  }
}

// deepseek-chat: $0.27/M input, $1.1/M output
function estimateCost(model: string, pt: number, ct: number): number {
  if (model.includes('deepseek-chat')) {
    return (pt / 1_000_000) * 0.27 + (ct / 1_000_000) * 1.10;
  }
  return 0;
}

export async function callOpenRouter(args: CallOpenRouterArgs): Promise<CallOpenRouterResult> {
  const started = Date.now();
  const model = args.model || DEFAULT_MODEL;
  const maxTokens = clampMaxTokens(args.maxTokens);

  if (shouldForce5xx()) {
    throw new Error('OpenRouter simulated 5xx (force test, NODE_ENV=test|development)');
  }

  // 自定义 provider（如 ToAPI）时用传入的 baseUrl/apiKey，绝不回退 OPENROUTER_API_KEY（防把 OR 的 key 发给别家）
  const url = args.baseUrl || OPENROUTER_URL;
  const apiKey = args.baseUrl ? args.apiKey : (args.apiKey || process.env.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error(args.baseUrl ? `LLM apiKey 未配置（自定义端点 ${args.baseUrl}）` : 'OPENROUTER_API_KEY not set');
  }

  let success = false;
  let errorMessage: string | undefined;
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let content = '';
  let actualModel = model;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: args.system
          ? [
              { role: 'system', content: args.system },
              { role: 'user', content: args.prompt },
            ]
          : [{ role: 'user', content: args.prompt }],
        max_tokens: maxTokens,
        ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      // reasoning_content：推理模型（如 ToAPI deepseek-v4-flash）把思考放这里，content 才是答案。
      // 我们只取 content；reasoning_content 一律丢弃，绝不漏给客户。
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      model?: string;
    };
    // 始终剥离思考过程，绝不把模型推理漏给客户（content 为空时保持空 → 上游按生成失败处理，绝不回退 reasoning_content）
    content = stripThinking(data.choices?.[0]?.message?.content ?? '');
    usage = data.usage ?? usage;
    actualModel = data.model || model;
    success = true;
  } catch (e) {
    errorMessage = (e as Error).message;
    throw e;
  } finally {
    await writeAudit({
      purpose: args.purpose,
      model: actualModel,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: estimateCost(actualModel, usage.prompt_tokens, usage.completion_tokens),
      duration_ms: Date.now() - started,
      success,
      error: errorMessage,
    });
  }

  return { content, usage, model: actualModel };
}
