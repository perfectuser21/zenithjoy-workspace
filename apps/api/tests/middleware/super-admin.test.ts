/**
 * 单元覆盖：super-admin 中间件的双路径鉴权
 *
 * 路径 1：用户身份（X-Feishu-User-Id 必须在 ADMIN_FEISHU_OPENIDS 白名单）
 * 路径 2：内部服务（X-Internal-Token 或 Bearer 与 ZENITHJOY_INTERNAL_TOKEN 匹配）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { superAdminGuard } from '../../src/middleware/super-admin';

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
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware/super-admin', () => {
  it('导出 superAdminGuard 函数', () => {
    expect(typeof superAdminGuard).toBe('function');
  });

  it('白名单内的 X-Feishu-User-Id 通过', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001,ou_admin_002');
    const req: any = makeReq({ 'x-feishu-user-id': 'ou_admin_001' });
    const res = makeRes();
    const next = vi.fn();
    superAdminGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.feishuUserId).toBe('ou_admin_001');
  });

  it('白名单外的 X-Feishu-User-Id 返回 403', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'ou_admin_001');
    const req = makeReq({ 'x-feishu-user-id': 'ou_random' });
    const res = makeRes();
    const next = vi.fn();
    superAdminGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('无 X-Feishu-User-Id 但 ZENITHJOY_INTERNAL_TOKEN 未设置时放行（dev 兼容）', () => {
    vi.stubEnv('ADMIN_FEISHU_OPENIDS', '');
    vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', '');
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    superAdminGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('无 X-Feishu-User-Id 但 internal token 匹配时放行', () => {
    vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'expected-token-xxx');
    const req = makeReq({ 'x-internal-token': 'expected-token-xxx' });
    const res = makeRes();
    const next = vi.fn();
    superAdminGuard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('无 X-Feishu-User-Id 且 internal token 错误时返回 401', () => {
    vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'expected-token-xxx');
    const req = makeReq({ 'x-internal-token': 'wrong-token' });
    const res = makeRes();
    const next = vi.fn();
    superAdminGuard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
