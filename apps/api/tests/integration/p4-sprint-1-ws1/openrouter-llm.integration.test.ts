/**
 * P4 WS1 — OpenRouter wrapper: FORCE_5XX + CI clamp + audit.
 *
 * commit-1 RED (skeleton throws not impl); commit-2 GREEN.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callOpenRouter } from '../../../src/llm/openrouter';

const origEnv = { ...process.env };

beforeEach(() => { process.env = { ...origEnv }; });
afterEach(() => { process.env = { ...origEnv }; vi.restoreAllMocks(); });

describe('P4 WS1 — OpenRouter LLM [BEHAVIOR]', () => {
  it('OPENROUTER_FORCE_5XX=1 + NODE_ENV=test 抛 simulated 5xx', async () => {
    process.env.OPENROUTER_FORCE_5XX = '1';
    process.env.NODE_ENV = 'test';
    await expect(
      callOpenRouter({ prompt: 'hi', purpose: 'unit_5xx_test' })
    ).rejects.toThrow(/simulated 5xx/);
  });

  it('OPENROUTER_FORCE_5XX=1 在 NODE_ENV=production 时被忽略 (不抛 simulated 5xx)', async () => {
    process.env.OPENROUTER_FORCE_5XX = '1';
    process.env.NODE_ENV = 'production';
    process.env.OPENROUTER_API_KEY = 'mock-key-no-real-call';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'deepseek/deepseek-chat',
      }), { status: 200 })
    );
    try {
      await callOpenRouter({ prompt: 'hi', purpose: 'unit_prod_ignore' });
    } catch (e: any) {
      expect(e.message).not.toMatch(/simulated 5xx/);
    }
  });

  it('CI=true 把 max_tokens clamp 到 ≤ 20', async () => {
    process.env.CI = 'true';
    process.env.NODE_ENV = 'test';
    process.env.OPENROUTER_FORCE_5XX = '';
    process.env.OPENROUTER_API_KEY = 'mock-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        model: 'deepseek/deepseek-chat',
      }), { status: 200 })
    );
    await callOpenRouter({ prompt: 'hi', purpose: 'unit_ci_clamp', maxTokens: 999 });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
    expect(body.max_tokens).toBeLessThanOrEqual(20);
  });
});
