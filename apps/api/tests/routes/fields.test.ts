import { describe, it, expect } from 'vitest';
import router from '../../src/routes/fields';

// /api/fields 路由配套测试(test-pairing 要求)。
// 端到端行为由 apps/api/tests/fields.test.ts(supertest 打整个 app)覆盖;
// 本文件断言路由模块可加载且导出 Router 实例,防路由文件被误删/破坏。
describe('routes/fields', () => {
  it('导出可挂载的 Express Router', () => {
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
    expect((router as unknown as { stack: unknown[] }).stack.length).toBeGreaterThan(0);
  });
});
