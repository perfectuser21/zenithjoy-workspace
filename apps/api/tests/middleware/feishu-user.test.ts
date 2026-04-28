/**
 * 单元覆盖：feishu-user 中间件的导出与基础行为
 *
 * 业务行为完整覆盖在 apps/api/tests/admin-license-me.test.ts（路由集成测试）。
 * 这里专注于中间件本身的契约：导出函数 + 缺头部 401 + 有头部 next。
 */
import { describe, it, expect, vi } from 'vitest';
import { feishuUser } from '../../src/middleware/feishu-user';

function makeReq(headers: Record<string, string> = {}): any {
  return { headers };
}

function makeRes(): any {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('middleware/feishu-user', () => {
  it('导出 feishuUser 函数', () => {
    expect(typeof feishuUser).toBe('function');
  });

  it('缺 X-Feishu-User-Id 头返回 401', () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    feishuUser(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('有 X-Feishu-User-Id 头时挂 req.feishuUserId 并 next', () => {
    const req: any = makeReq({ 'x-feishu-user-id': 'ou_test_001' });
    const res = makeRes();
    const next = vi.fn();
    feishuUser(req, res, next);
    expect(req.feishuUserId).toBe('ou_test_001');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
