// apps/api/src/middleware/simple-rate-limit.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { simpleRateLimit, tenantKeyFn } from './simple-rate-limit';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

// buckets 是模块级单例 Map，每个用例必须用互不相同的 key，
// 否则前一个用例留下的命中记录会污染后一个用例（同一 60s 窗口内不会自然过期）。
describe('simpleRateLimit', () => {
  it('放行窗口内 max 次以内的请求', () => {
    const mw = simpleRateLimit({ windowMs: 60_000, max: 3, keyFn: () => 'test-key-allow' });
    const next: NextFunction = vi.fn();
    for (let i = 0; i < 3; i++) {
      mw({} as Request, mockRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('超过 max 次后返回 429 RATE_LIMITED', () => {
    const mw = simpleRateLimit({ windowMs: 60_000, max: 2, keyFn: () => 'test-key-block' });
    const next: NextFunction = vi.fn();
    mw({} as Request, mockRes(), next);
    mw({} as Request, mockRes(), next);
    const res3 = mockRes();
    mw({} as Request, res3, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res3.status).toHaveBeenCalledWith(429);
    expect(res3.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'RATE_LIMITED' }) }),
    );
  });

  it('不同 key 互不影响（按 tenant 隔离）', () => {
    const mw = simpleRateLimit({ windowMs: 60_000, max: 1, keyFn: (req: Request) => (req as { tid: string }).tid });
    const next: NextFunction = vi.fn();
    mw({ tid: 'test-key-isolate-a' } as unknown as Request, mockRes(), next);
    const resB = mockRes();
    mw({ tid: 'test-key-isolate-b' } as unknown as Request, resB, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(resB.status).not.toHaveBeenCalled();
  });

  it('窗口过期后计数重置', async () => {
    const mw = simpleRateLimit({ windowMs: 20, max: 1, keyFn: () => 'test-key-expire' });
    const next: NextFunction = vi.fn();
    mw({} as Request, mockRes(), next);
    await new Promise((r) => setTimeout(r, 30));
    const res2 = mockRes();
    mw({} as Request, res2, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res2.status).not.toHaveBeenCalled();
  });
});

describe('tenantKeyFn', () => {
  it('优先取 req.tenantId', () => {
    const req = { tenantId: 'from-context', body: { tenant_id: 'from-body' } } as unknown as Request;
    expect(tenantKeyFn(req)).toBe('from-context');
  });

  it('req.tenantId 缺失时回退 body.tenant_id', () => {
    const req = { body: { tenant_id: 'from-body' } } as unknown as Request;
    expect(tenantKeyFn(req)).toBe('from-body');
  });

  it('都没有时回退 query.tenant_id，再没有则 anonymous', () => {
    const req1 = { body: {}, query: { tenant_id: 'from-query' } } as unknown as Request;
    expect(tenantKeyFn(req1)).toBe('from-query');

    const req2 = { body: {}, query: {} } as unknown as Request;
    expect(tenantKeyFn(req2)).toBe('anonymous');
  });
});
