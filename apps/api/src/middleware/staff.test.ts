/**
 * 单元覆盖：staff 中间件鉴权
 *
 * 规则：X-User-Email 在 STAFF_EMAILS 白名单，或 X-Feishu-User-Id 在 STAFF_FEISHU_OPENIDS
 * 白名单，任一命中 → next()；都未命中 → 403。两个白名单都未配置时一律 403（不同于
 * superAdminGuard 的 dev 放行）。
 *
 * open_id 兜底的原因：部分飞书账号从不返回 email（即使已开通 contact:user.email:readonly
 * 权限），open_id 是飞书 OAuth 必定返回的字段，不依赖任何额外权限审批。
 *
 * 合同对应：contract-dod.md BEHAVIOR FR9 + N4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { staffGuard } from './staff';

interface FakeReq {
  headers: Record<string, string>;
}

interface FakeRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function makeReq(headers: Record<string, string> = {}): FakeReq {
  return { headers };
}

function makeRes(): FakeRes {
  const res = {} as FakeRes;
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware/staff', () => {
  it('导出 staffGuard 函数', () => {
    expect(typeof staffGuard).toBe('function');
  });

  it('白名单内的 X-User-Email 通过（调 next）', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com,another@test.com');
    const req = makeReq({ 'x-user-email': 'staff@test.com' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('邮箱比较不区分大小写', () => {
    vi.stubEnv('STAFF_EMAILS', 'Staff@Test.com');
    const req = makeReq({ 'x-user-email': 'STAFF@TEST.COM' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('白名单外的邮箱返回 403', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const req = makeReq({ 'x-user-email': 'unknown@test.com' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('无 X-User-Email 头时返回 403', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('STAFF_EMAILS 未设置时一律 403（不放行，N4 铁律）', () => {
    vi.stubEnv('STAFF_EMAILS', '');
    const req = makeReq({ 'x-user-email': 'anyone@test.com' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('空 X-User-Email 头值时返回 403', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const req = makeReq({ 'x-user-email': '' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 响应体含 FORBIDDEN error code', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    const body = res.json.mock.calls[0]?.[0];
    expect(body?.error?.code).toBe('FORBIDDEN');
  });

  it('白名单内的 X-Feishu-User-Id 通过（调 next），无需邮箱（部分飞书账号从不返回邮箱字段）', () => {
    vi.stubEnv('STAFF_EMAILS', '');
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_f8fea87de8cc141b1b94914780eed76b,ou_other');
    const req = makeReq({ 'x-feishu-user-id': 'ou_f8fea87de8cc141b1b94914780eed76b' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('白名单外的 X-Feishu-User-Id 返回 403', () => {
    vi.stubEnv('STAFF_EMAILS', '');
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_admin_001');
    const req = makeReq({ 'x-feishu-user-id': 'ou_stranger' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('X-User-Email 不在白名单，但 X-Feishu-User-Id 在白名单 → 通过（两条身份路径任一命中即可）', () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_admin_001');
    const req = makeReq({ 'x-user-email': 'unknown@test.com', 'x-feishu-user-id': 'ou_admin_001' });
    const res = makeRes();
    const next = vi.fn();
    staffGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
