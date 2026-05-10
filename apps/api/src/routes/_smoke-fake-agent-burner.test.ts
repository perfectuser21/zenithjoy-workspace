/**
 * Path 2 Sprint B-1 — apps/api/src/routes/_smoke-fake-agent-burner.ts pairing placeholder
 *
 * 真行为测试在 apps/api/tests/integration/p2-sprint-b1-ws3/smoke-fake-agent-burner.test.ts
 * 此文件是 lint-test-pairing 配套要求。
 */
import { describe, it, expect } from 'vitest';

describe('_smoke-fake-agent-burner.ts (placeholder pairing)', () => {
  it('module 可被 import（真测见 tests/integration/p2-sprint-b1-ws3/smoke-fake-agent-burner.test.ts）', async () => {
    const mod = await import('./_smoke-fake-agent-burner');
    expect(mod.default).toBeTruthy();
    expect(typeof mod.default).toBe('function');
  });
});
