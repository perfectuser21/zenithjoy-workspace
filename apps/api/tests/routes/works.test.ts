/**
 * Sprint B WS2 — works router 中间件挂载契约
 *
 * 完整 BEHAVIOR 在 apps/api/tests/works-multitenant.test.ts（端到端 supertest）。
 * 此处快速验证 router 模块导出。
 */
import { describe, it, expect } from 'vitest';
import worksRouter from '../../src/routes/works';

describe('routes/works 契约', () => {
  it('默认导出 Express Router', () => {
    expect(worksRouter).toBeDefined();
    // express.Router 是函数（中间件签名）
    expect(typeof worksRouter).toBe('function');
  });

  it('router 含至少 5 个 route 定义（GET / GET :id / POST / PUT / DELETE）', () => {
    // 中间件改为 per-route 挂载（v2，避免嵌套路径如 /api/works/:id/publish-logs 被拦）
    const stack = (worksRouter as unknown as { stack?: unknown[] }).stack ?? [];
    expect(stack.length).toBeGreaterThanOrEqual(5);
  });
});
