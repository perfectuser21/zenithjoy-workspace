import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

export interface CallOpenRouterArgs {
  prompt: string;
  purpose: string;
  maxTokens?: number;
  model?: string;
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
  if (process.env.CI === 'true') return Math.min(base, 20);
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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  let success = false;
  let errorMessage: string | undefined;
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let content = '';
  let actualModel = model;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: args.prompt }],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json() as any;
    content = data.choices?.[0]?.message?.content ?? '';
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
