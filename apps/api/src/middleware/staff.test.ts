/**
 * 单元覆盖：staff 中间件鉴权
 *
 * 规则：X-User-Email 在 STAFF_EMAILS 白名单 → next()；否则 403。
 * STAFF_EMAILS 未设置时一律 403（不同于 superAdminGuard 的 dev 放行）。
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
});
