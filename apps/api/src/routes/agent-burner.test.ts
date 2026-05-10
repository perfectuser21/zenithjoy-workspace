/**
 * Path 2 Sprint B-1 — apps/api/src/routes/agent-burner.ts pairing placeholder
 *
 * 真行为测试在 apps/api/tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts
 * （integration 测，需 supertest + DB；放 integration config 跑）
 * 此文件是 lint-test-pairing 配套要求 — 让 src 旁有同名 .test.ts。
 */
import { describe, it, expect } from 'vitest';

describe('agent-burner.ts (placeholder pairing)', () => {
  it('routes module 可被 import（真测见 tests/integration/p2-sprint-b1-ws3/agent-burner-routes.test.ts）', async () => {
    const mod = await import('./agent-burner');
    expect(mod.default).toBeTruthy();
    expect(typeof mod.default).toBe('function'); // express Router 是 function
  });
});
