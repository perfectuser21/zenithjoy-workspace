/**
 * tenant-context 中间件单元测试（v3 — PR-2 better-auth session 桥接）
 *
 * 解析链顺序：
 *   1. better-auth session（cookie）→ tenant_members.feishu_user_id = userId
 *   2. 旧路径 X-Feishu-User-Id 头 → tenant_members.feishu_user_id（向后兼容）
 *   3. 都没 → 401
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tenantContext } from '../../src/middleware/tenant-context';
import pool from '../../src/db/connection';
import { auth } from '../../src/auth';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../src/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

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

describe('middleware/tenant-context (PR-2)', () => {
  it('导出 tenantContext 函数', () => {
    expect(typeof tenantContext).toBe('function');
  });

  it('既无 better-auth session 也无 X-Feishu-User-Id 头 → 401', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('better-auth session 命中 → 用 user.id 反查 tenant_members → next', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'auth-user-uuid-1' },
      session: { id: 'sess-1' },
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-A', role: 'owner' }],
    });
    const req: any = makeReq({ cookie: 'better-auth.session_token=xxx' });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantId).toBe('tenant-uuid-A');
    expect(req.feishuUserId).toBe('auth-user-uuid-1');
    expect(req.tenantRole).toBe('owner');
    expect(mockQuery).toHaveBeenCalled();
    const sqlArg = mockQuery.mock.calls[0][1];
    expect(sqlArg).toEqual(['auth-user-uuid-1']);
  });

  it('better-auth session 用户未关联 tenant → 403 NO_TENANT', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'auth-user-orphan' },
      session: { id: 'sess-2' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({ cookie: 'better-auth.session_token=xxx' });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    const jsonCall = res.json.mock.calls[0]?.[0];
    expect(jsonCall?.error?.code).toBe('NO_TENANT');
  });

  it('无 better-auth session 但有 X-Feishu-User-Id 头 → 走旧路径', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-uuid-feishu', role: 'member' }],
    });
    const req: any = makeReq({ 'x-feishu-user-id': 'ou_alice' });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantId).toBe('tenant-uuid-feishu');
    expect(req.feishuUserId).toBe('ou_alice');
    expect(req.tenantRole).toBe('member');
  });

  it('better-auth session 优先于 X-Feishu-User-Id（同时存在）', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'auth-user-uuid-2' },
      session: { id: 'sess-3' },
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: 'tenant-from-session', role: 'owner' }],
    });
    const req: any = makeReq({
      cookie: 'better-auth.session_token=yyy',
      'x-feishu-user-id': 'ou_should_be_ignored',
    });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.feishuUserId).toBe('auth-user-uuid-2');
    expect(req.tenantId).toBe('tenant-from-session');
    const sqlArg = mockQuery.mock.calls[0][1];
    expect(sqlArg).toEqual(['auth-user-uuid-2']);
  });

  it('用户不在任何 tenant_members（旧路径）返回 403 NO_TENANT', async () => {
    mockGetSession.mockResolvedValueOnce(null);
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
    mockGetSession.mockResolvedValueOnce(null);
    const req: any = makeReq({
      'x-feishu-user-id': 'ou_admin_001',
      'x-bypass-tenant': 'true',
    });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(req.tenantRole).toBe('super-admin');
  });

  it('非 admin + X-Bypass-Tenant=true 不跳过（仍走 tenant 查询）', async () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    mockGetSession.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = makeReq({
      'x-feishu-user-id': 'ou_random',
      'x-bypass-tenant': 'true',
    });
    const res = makeRes();
    const next = vi.fn();
    await tenantContext(req, res, next);
    expect(mockQuery).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
