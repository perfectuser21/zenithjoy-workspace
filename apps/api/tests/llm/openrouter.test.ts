/**
 * ws1 OpenRouter 封装测试。
 *
 * 校验：
 *   1) OPENROUTER_FORCE_5XX=1 + NODE_ENV=test → callOpenRouter 抛 5xx 错误
 *   2) NODE_ENV=production + OPENROUTER_FORCE_5XX=1 → 故障开关被忽略（真调 fetch）
 *   3) CI=true → callOpenRouter 内部 max_tokens ≤ 20
 *   4) 调用成功后 llm_audit 表收到 INSERT
 *
 * 用 mock global.fetch + mock pg pool，不真调 OpenRouter / DB。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 把 db connection mock 掉，让 openrouter.ts 不真连 pg
const insertSpy = vi.fn();
vi.mock('../../src/db/connection', () => ({
  default: {
    query: insertSpy.mockResolvedValue({ rows: [], rowCount: 1 }),
    end: vi.fn(),
    connect: vi.fn(),
  },
}));

describe('ws1 callOpenRouter — OPENROUTER_FORCE_5XX 故障注入', () => {
  beforeEach(() => {
    vi.resetModules();
    insertSpy.mockClear();
    process.env.OPENROUTER_API_KEY = 'sk-test-fake';
    delete process.env.OPENROUTER_FORCE_5XX;
    delete process.env.CI;
  });

  afterEach(() => {
    delete process.env.OPENROUTER_FORCE_5XX;
    delete process.env.CI;
  });

  it('NODE_ENV=test + OPENROUTER_FORCE_5XX=1 → 抛错，错误信息含 simulated/5xx/503', async () => {
    process.env.NODE_ENV = 'test';
    process.env.OPENROUTER_FORCE_5XX = '1';
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    await expect(callOpenRouter({ prompt: 'hi' })).rejects.toThrow(
      /simulated|5xx|503/i,
    );
  });

  it('NODE_ENV=development + OPENROUTER_FORCE_5XX=1 → 也生效（开发期可注入）', async () => {
    process.env.NODE_ENV = 'development';
    process.env.OPENROUTER_FORCE_5XX = '1';
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    await expect(callOpenRouter({ prompt: 'hi' })).rejects.toThrow(
      /simulated|5xx|503/i,
    );
  });

  it('NODE_ENV=production + OPENROUTER_FORCE_5XX=1 → 故障开关被忽略，真调 fetch', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENROUTER_FORCE_5XX = '1';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    }));
    // @ts-expect-error overriding global
    globalThis.fetch = fetchMock;
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    const result = await callOpenRouter({ prompt: 'hi' });
    expect(fetchMock).toHaveBeenCalled();
    expect(result.content).toBe('OK');
  });
});

describe('ws1 callOpenRouter — CI max_tokens cap', () => {
  beforeEach(() => {
    vi.resetModules();
    insertSpy.mockClear();
    process.env.OPENROUTER_API_KEY = 'sk-test-fake';
    delete process.env.OPENROUTER_FORCE_5XX;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.CI;
  });

  it('CI=true → max_tokens ≤ 20（内部 cap）', async () => {
    process.env.CI = 'true';
    const captured: any[] = [];
    const fetchMock = vi.fn(async (_url: string, opts: any) => {
      captured.push(JSON.parse(opts.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    });
    // @ts-expect-error overriding global
    globalThis.fetch = fetchMock;
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    // 用方传更大 max_tokens，应被 cap 到 20
    await callOpenRouter({ prompt: 'hello', max_tokens: 1000 });
    expect(captured.length).toBe(1);
    expect(captured[0].max_tokens).toBeLessThanOrEqual(20);
  });

  it('CI 不为 true → max_tokens 不强制 cap', async () => {
    delete process.env.CI;
    const captured: any[] = [];
    const fetchMock = vi.fn(async (_url: string, opts: any) => {
      captured.push(JSON.parse(opts.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      };
    });
    // @ts-expect-error overriding global
    globalThis.fetch = fetchMock;
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    await callOpenRouter({ prompt: 'hello', max_tokens: 500 });
    expect(captured[0].max_tokens).toBeGreaterThan(20);
  });
});

describe('ws1 callOpenRouter — llm_audit 写表', () => {
  beforeEach(() => {
    vi.resetModules();
    insertSpy.mockClear();
    process.env.OPENROUTER_API_KEY = 'sk-test-fake';
    process.env.NODE_ENV = 'test';
    delete process.env.OPENROUTER_FORCE_5XX;
    delete process.env.CI;
  });

  it('调用成功后 INSERT llm_audit（provider/model/tokens/cost/request_purpose）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 7, cost: 0.00012 },
      }),
    }));
    // @ts-expect-error overriding global
    globalThis.fetch = fetchMock;
    const { callOpenRouter } = await import('../../src/llm/openrouter');
    await callOpenRouter({ prompt: 'hi', purpose: 'unit_test' });
    expect(insertSpy).toHaveBeenCalled();
    // 找出 INSERT 调用（允许 schema 前缀 zenithjoy.llm_audit）
    const insertCalls = insertSpy.mock.calls.filter((c) =>
      /INSERT\s+INTO\s+(?:\w+\.)?llm_audit/i.test(c[0]),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // 校验值数组含 model deepseek + purpose 'unit_test'
    const params = insertCalls[0][1] || [];
    expect(params.some((v: any) => /deepseek/i.test(String(v)))).toBe(true);
    expect(params).toContain('unit_test');
  });
});
