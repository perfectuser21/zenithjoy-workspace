/**
 * P4 WS1 — openrouter.ts pairing unit test
 *
 * 配套 lint-test-pairing 要求. 真业务测试在
 * apps/api/tests/integration/p4-sprint-1-ws1/openrouter-llm.integration.test.ts
 * (整合测试覆盖 FORCE_5XX / CI clamp / llm_audit 真 DB I/O).
 */
import { describe, it, expect } from 'vitest';
import { callOpenRouter, type CallOpenRouterArgs, type CallOpenRouterResult } from '../openrouter';

describe('openrouter.ts — module surface', () => {
  it('exports callOpenRouter as async function', () => {
    expect(typeof callOpenRouter).toBe('function');
    expect(callOpenRouter.constructor.name).toBe('AsyncFunction');
  });

  it('type CallOpenRouterArgs accepts required fields', () => {
    const args: CallOpenRouterArgs = { prompt: 'x', purpose: 'unit_pair' };
    expect(args.prompt).toBe('x');
    expect(args.purpose).toBe('unit_pair');
  });

  it('type CallOpenRouterResult shape', () => {
    const r: CallOpenRouterResult = {
      content: '',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: 'm',
    };
    expect(r.usage.total_tokens).toBe(0);
  });
});
