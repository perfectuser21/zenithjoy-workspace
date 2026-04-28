/**
 * Sprint B WS2 — works.controller 契约
 *
 * 完整 BEHAVIOR 在 apps/api/tests/works-multitenant.test.ts（路由集成）。
 * 此处验证 controller 类导出 + 5 个方法存在。
 */
import { describe, it, expect } from 'vitest';
import { WorksController } from '../../src/controllers/works.controller';

describe('controllers/works.controller 契约', () => {
  it('导出 WorksController 类', () => {
    expect(typeof WorksController).toBe('function');
  });

  it('实例含 5 个 handler', () => {
    const c = new WorksController();
    expect(typeof c.getWorks).toBe('function');
    expect(typeof c.getWorkById).toBe('function');
    expect(typeof c.createWork).toBe('function');
    expect(typeof c.updateWork).toBe('function');
    expect(typeof c.deleteWork).toBe('function');
  });
});
