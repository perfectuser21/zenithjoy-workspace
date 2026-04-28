/**
 * tenant-context 中间件单元测试（v2 —— Sprint B owner_id 方案统一为 tenant 级）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tenantContext } from '../../src/middleware/tenant-context';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

function makeReq(headers: Record<string, string> = {}): any {
  return { headers };
}

function makeRes(): any {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware/tenant-context', () => {
  it('导出 tenantContext 函数', () => {
    expect(typeof tenantContext).toBe('function');
  });

  it('缺 X-Feishu-User-Id 头返回 401 UNAUTHORIZED', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('用户在 tenant_members 中找到 → 设 req.tenantId / next', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-A', role: 'owner' }],
    });
    const req: any = makeReq({ 'x-feishu-user-id': 'ou_alice' });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantId).toBe('tenant-uuid-A');
    expect(req.feishuUserId).toBe('ou_alice');
    expect(req.tenantRole).toBe('owner');
  });

  it('用户不在任何 tenant_members 返回 403 NO_TENANT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ 'x-feishu-user-id': 'ou_orphan' });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    const jsonCall = res.json.mock.calls[0]?.[0];
    expect(jsonCall?.error?.code).toBe('NO_TENANT');
    expect(next).not.toHaveBeenCalled();
  });

  it('super-admin + X-Bypass-Tenant=true 跳过 tenant 查询直接 next', async () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    const req: any = makeReq({
      'x-feishu-user-id': 'ou_admin_001',
      'x-bypass-tenant': 'true',
    });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled(); // 不查 DB
    expect(req.tenantRole).toBe('super-admin');
  });

  it('非 admin + X-Bypass-Tenant=true 不跳过（仍走 tenant 查询）', async () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({
      'x-feishu-user-id': 'ou_random',
      'x-bypass-tenant': 'true',
    });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(mockQuery).toHaveBeenCalled(); // 查了 tenant_members
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
