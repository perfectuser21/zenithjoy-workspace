/**
 * cs-config-guard 单元测试（与 src 配套，lint-test-pairing 要求）
 *
 * 直接驱动中间件 requireCsAdmin / requireSameTenant，断言：
 *   - 角色闸：member/无 role → 403 NOT_ADMIN；owner/admin/super-admin → next()
 *   - 租户隔离：目标 != 当前 → 403 CROSS_TENANT；解析不出 → 404 TARGET_NOT_FOUND（deny by default）；
 *     super-admin 跨租户短路放行（但目标仍需可解析）。
 *
 * 端到端 HTTP + 写库 0 调用断言见 tests/regression/line04-cs-config-permission.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

import { requireCsAdmin, requireSameTenant } from './cs-config-guard';

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

interface DenyBody {
  error?: { code?: string };
}

function mkRes() {
  const res = {
    statusCode: 0,
    body: undefined as DenyBody | undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as DenyBody;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: DenyBody };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('requireCsAdmin — 管理员角色闸', () => {
  it('member → 403 NOT_ADMIN，不调 next', () => {
    const req = { tenantRole: 'member', tenantId: TENANT_A } as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error?.code).toBe('NOT_ADMIN');
    expect(next).not.toHaveBeenCalled();
  });

  it('无 role → 403 NOT_ADMIN', () => {
    const req = { tenantId: TENANT_A } as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'super-admin'])('%s → next()', (role) => {
    const req = { tenantRole: role, tenantId: TENANT_A } as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});

describe('requireSameTenant — 租户隔离 + deny by default', () => {
  it('同租户 → next()', async () => {
    mockQuery.mockResolvedValue({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const req = { params: { wechatId: 'wxid_csa' }, tenantId: TENANT_A, tenantRole: 'admin' } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireSameTenant('wechatId')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('跨租户 → 403 CROSS_TENANT，不调 next', async () => {
    mockQuery.mockResolvedValue({ rows: [{ tenant_id: TENANT_B }], rowCount: 1 });
    const req = { params: { wechatId: 'wxid_csb' }, tenantId: TENANT_A, tenantRole: 'admin' } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireSameTenant('wechatId')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.error?.code).toBe('CROSS_TENANT');
    expect(next).not.toHaveBeenCalled();
  });

  it('解析不出目标租户 → 404 TARGET_NOT_FOUND（deny by default），不调 next', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const req = { params: { wechatId: 'wxid_never' }, tenantId: TENANT_A, tenantRole: 'admin' } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireSameTenant('wechatId')(req, res, next);
    expect(res.statusCode).toBe(404);
    expect(res.body.error?.code).toBe('TARGET_NOT_FOUND');
    expect(next).not.toHaveBeenCalled();
  });

  it('目标标识缺失 → 404 TARGET_NOT_FOUND，不查库', async () => {
    const req = { params: {}, tenantId: TENANT_A, tenantRole: 'admin' } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireSameTenant('wechatId')(req, res, next);
    expect(res.statusCode).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('super-admin 跨租户短路放行（目标可解析时 → next）', async () => {
    mockQuery.mockResolvedValue({ rows: [{ tenant_id: TENANT_B }], rowCount: 1 });
    const req = { params: { machineId: 'machine-b' }, tenantId: '', tenantRole: 'super-admin' } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireSameTenant('machineId')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
