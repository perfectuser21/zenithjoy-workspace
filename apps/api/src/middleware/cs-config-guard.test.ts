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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockQuery, mockValidateLicense } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockValidateLicense: vi.fn(),
}));
vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));
vi.mock('../services/walking-skeleton.service', () => ({
  validateLicense: mockValidateLicense,
}));

import {
  requireCsAdmin,
  requireSameTenant,
  requireCsReadAccess,
  requireServiceCredential,
} from './cs-config-guard';

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
  mockValidateLicense.mockReset();
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

describe('requireServiceCredential — agent/服务专用闸（internal/service token，非人类 session）', () => {
  const OLD_ENV = process.env.ZENITHJOY_INTERNAL_TOKEN;
  beforeEach(() => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'svc-tok-123';
  });
  afterEach(() => {
    // 还原 env，避免污染其它用例
    if (OLD_ENV === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    else process.env.ZENITHJOY_INTERNAL_TOKEN = OLD_ENV;
  });

  it('合法 X-Internal-Token → next()', () => {
    const req = { headers: { 'x-internal-token': 'svc-tok-123' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it('合法 Bearer token → next()', () => {
    const req = { headers: { authorization: 'Bearer svc-tok-123' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('ADMIN_FEISHU_OPENIDS 头 → next()（super-admin 飞书白名单）', () => {
    const old = process.env.ADMIN_FEISHU_OPENIDS;
    process.env.ADMIN_FEISHU_OPENIDS = 'ou_admin_x';
    const req = { headers: { 'x-feishu-user-id': 'ou_admin_x' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    if (old === undefined) delete process.env.ADMIN_FEISHU_OPENIDS;
    else process.env.ADMIN_FEISHU_OPENIDS = old;
  });

  it('env 已设 + 无凭证 → 401（生产闸，拒绝无 token 上报）', () => {
    // beforeEach 已设 ZENITHJOY_INTERNAL_TOKEN=svc-tok-123
    const req = { headers: {} } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('env 已设 + 错 token → 401（生产闸）', () => {
    const req = { headers: { 'x-internal-token': 'wrong-tok' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('env 未设 + 无头 → dev 放行 next()（与 agent post_friend_scan「未设不带头」对齐）', () => {
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    const req = { headers: {} } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});

// ─── Gap1：agent license 自证鉴权（不再依赖客户端 .env 烧共享 internal token）───
// 真 agent 只有 license（注册/心跳已用 license 认证），ingest/pending/onboarding 上报时带
// X-License-Key 自证身份。后端校验 license → tenant_id，挂到 req.tenantId 供 handler 同租户隔离。
describe('requireServiceCredential — Gap1 agent license 自证（X-License-Key / 合规 Bearer）', () => {
  const OLD_ENV = process.env.ZENITHJOY_INTERNAL_TOKEN;
  const TENANT_LIC = 'cccccccc-1111-2222-3333-444444444444';
  beforeEach(() => {
    // 生产闸：internal token 已设（模拟生产环境），但 agent 没有它——只能靠 license 自证。
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'svc-tok-123';
  });
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    else process.env.ZENITHJOY_INTERNAL_TOKEN = OLD_ENV;
  });

  it('合法 X-License-Key（active + 有 tenant）→ 放行 next() 并挂 req.tenantId', async () => {
    mockValidateLicense.mockResolvedValue({
      ok: true,
      license: { id: 'lic-1', license_key: 'ZJ-B-AAAA1111', tenant_id: TENANT_LIC, status: 'active', expires_at: '2099-01-01' },
    });
    const req = { headers: { 'x-license-key': 'ZJ-B-AAAA1111' } } as unknown as Request & { tenantId?: string };
    const res = mkRes();
    const next = vi.fn();
    await requireServiceCredential(req, res, next);
    expect(mockValidateLicense).toHaveBeenCalledWith('ZJ-B-AAAA1111');
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    expect(req.tenantId).toBe(TENANT_LIC);
  });

  it('合法 Bearer <license_key>（ZJ- 格式）→ 走 license 自证放行', async () => {
    mockValidateLicense.mockResolvedValue({
      ok: true,
      license: { id: 'lic-2', license_key: 'ZJ-F-BBBB2222', tenant_id: TENANT_LIC, status: 'active', expires_at: '2099-01-01' },
    });
    const req = { headers: { authorization: 'Bearer ZJ-F-BBBB2222' } } as unknown as Request & { tenantId?: string };
    const res = mkRes();
    const next = vi.fn();
    await requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.tenantId).toBe(TENANT_LIC);
  });

  it('无效/吊销 license（validateLicense 失败）→ 401，不放行', async () => {
    mockValidateLicense.mockResolvedValue({ ok: false, code: 'REVOKED', message: 'license 已吊销' });
    const req = { headers: { 'x-license-key': 'ZJ-B-DEADBEEF' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireServiceCredential(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Bearer <internal-token>（非 ZJ- 格式）→ 仍走 superAdminGuard token 路径（向后兼容）', async () => {
    const req = { headers: { authorization: 'Bearer svc-tok-123' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    await requireServiceCredential(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    // 没走 license 路径（不该调 validateLicense）
    expect(mockValidateLicense).not.toHaveBeenCalled();
  });
});

describe('requireCsReadAccess — 读接口多通道闸（legacy/super-admin ∪ 租户 session）', () => {
  it('legacy 服务凭证（internal token）→ superAdminGuard 放行 next()', () => {
    const old = process.env.ZENITHJOY_INTERNAL_TOKEN;
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'svc-tok-123';
    const req = { headers: { 'x-internal-token': 'svc-tok-123' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsReadAccess(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    if (old === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    else process.env.ZENITHJOY_INTERNAL_TOKEN = old;
  });

  it('super-admin 飞书白名单头 → 放行 next()', () => {
    const old = process.env.ADMIN_FEISHU_OPENIDS;
    process.env.ADMIN_FEISHU_OPENIDS = 'ou_admin_y';
    const req = { headers: { 'x-feishu-user-id': 'ou_admin_y' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsReadAccess(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    if (old === undefined) delete process.env.ADMIN_FEISHU_OPENIDS;
    else process.env.ADMIN_FEISHU_OPENIDS = old;
  });

  // 修 403：邮箱超管（X-User-Email ∈ ADMIN_EMAILS）必须经 legacy 旁路走 superAdminGuard 邮箱路径放行，
  // 否则落到裸 tenantContext，而超管邮箱常不属任何租户 → 403。
  it('邮箱超管头（X-User-Email ∈ ADMIN_EMAILS）→ 放行 next()（修 403）', () => {
    const old = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'boss@zenjoymedia.media,alex@example.com';
    const req = { headers: { 'x-user-email': 'boss@zenjoymedia.media' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsReadAccess(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
    if (old === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = old;
  });

  it('邮箱超管大小写不敏感（X-User-Email 大写仍匹配小写白名单）', () => {
    const old = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'boss@zenjoymedia.media';
    const req = { headers: { 'x-user-email': 'BOSS@ZenJoyMedia.Media' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsReadAccess(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    if (old === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = old;
  });

  it('非白名单邮箱不被当 legacy 超管（不短路，落 tenantContext）', () => {
    // 不在 ADMIN_EMAILS 的邮箱不应被 hasLegacyServiceCredential 认作超管 → 不调 superAdminGuard 的放行路径。
    // 无 tenant 上下文 + 无 better-auth session → 经 tenantContext 必拒（401/403），断言未被直接 next() 放行。
    const old = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'boss@zenjoymedia.media';
    const req = { headers: { 'x-user-email': 'stranger@evil.com' } } as unknown as Request;
    const res = mkRes();
    const next = vi.fn();
    requireCsReadAccess(req, res, next);
    expect(next).not.toHaveBeenCalled();
    if (old === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = old;
  });
});
