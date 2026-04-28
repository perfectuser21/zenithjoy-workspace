/**
 * Sprint B WS1 — works.service ownerId 化契约
 *
 * 完整 BEHAVIOR 在 apps/api/tests/works-multitenant.test.ts（路由集成）。
 * 此处验证 service 类导出 + TenantContext 类型契约。
 */
import { describe, it, expect } from 'vitest';
import { WorksService, type TenantContext } from '../../src/services/works.service';

describe('services/works.service 契约', () => {
  it('导出 WorksService 类', () => {
    expect(typeof WorksService).toBe('function');
  });

  it('TenantContext 类型存在（含 ownerId + bypassTenant 字段）', () => {
    const ctx: TenantContext = { ownerId: 'ou_test', bypassTenant: true };
    expect(ctx.ownerId).toBe('ou_test');
    expect(ctx.bypassTenant).toBe(true);
  });

  it('WorksService 实例方法签名（5 个方法均接受 ctx 参数）', () => {
    const svc = new WorksService();
    expect(typeof svc.getWorks).toBe('function');
    expect(typeof svc.getWorkById).toBe('function');
    expect(typeof svc.createWork).toBe('function');
    expect(typeof svc.updateWork).toBe('function');
    expect(typeof svc.deleteWork).toBe('function');
    // 至少接受 ctx：getWorks 长度 2，其他 2/3
    expect(svc.getWorks.length).toBeGreaterThanOrEqual(2);
    expect(svc.getWorkById.length).toBeGreaterThanOrEqual(2);
    expect(svc.createWork.length).toBeGreaterThanOrEqual(2);
    expect(svc.updateWork.length).toBeGreaterThanOrEqual(3);
    expect(svc.deleteWork.length).toBeGreaterThanOrEqual(2);
  });
});
