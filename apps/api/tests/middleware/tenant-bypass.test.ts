/**
 * Sprint B · WS2 — tenant-bypass 中间件单元测试
 *
 * 规则：
 *  - admin（X-Feishu-User-Id 在 ADMIN_FEISHU_OPENIDS）+ X-Bypass-Tenant: true → 设 req.bypassTenant = true
 *  - 其他情况：req.bypassTenant 默认 false / undefined
 *
 * 注意：这是一个修饰性中间件，不阻止请求通过；它只是在 admin 携带 bypass 头时挂上标志。
 * 实际的鉴权应由 feishuUser 单独负责。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tenantBypass } from '../../src/middleware/tenant-bypass';

function makeReq(headers: Record<string, string> = {}): any {
  return { headers };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware/tenant-bypass', () => {
  it('导出 tenantBypass 函数', () => {
    expect(typeof tenantBypass).toBe('function');
  });

  it('admin + X-Bypass-Tenant=true 设 req.bypassTenant=true', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    const req: any = makeReq({
      'x-feishu-user-id': 'ou_admin_001',
      'x-bypass-tenant': 'true',
    });
    const next = vi.fn();
    tenantBypass(req, {} as any, next);
    expect(req.bypassTenant).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('admin + X-Bypass-Tenant 缺失 不设 bypassTenant', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    const req: any = makeReq({ 'x-feishu-user-id': 'ou_admin_001' });
    const next = vi.fn();
    tenantBypass(req, {} as any, next);
    expect(req.bypassTenant).not.toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('非 admin + X-Bypass-Tenant=true 不设 bypassTenant（防滥用）', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    const req: any = makeReq({
      'x-feishu-user-id': 'ou_random',
      'x-bypass-tenant': 'true',
    });
    const next = vi.fn();
    tenantBypass(req, {} as any, next);
    expect(req.bypassTenant).not.toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
