/**
 * middleware/auth.ts 配套单元测试（lint-test-pairing 要求）
 *
 * auth.ts 是公共鉴权中间件薄层，导出：
 *   - requireCsWriteAccess（re-export from cs-config-guard）
 *   - bodyWechatIdToParam（本文件定义）
 *
 * 本测试验证：
 *   1. requireCsWriteAccess 导出存在且为函数
 *   2. bodyWechatIdToParam：正常 body.wechat_id → req.params.wechatId trim 后赋值
 *   3. bodyWechatIdToParam：body.wechat_id 缺失 → req.params.wechatId = ''
 *   4. bodyWechatIdToParam：wechat_id 带空白 → trim 后写入
 *   5. bodyWechatIdToParam：非字符串类型 → req.params.wechatId = ''
 *   6. bodyWechatIdToParam 总是调用 next()
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// mock cs-config-guard，避免拉取其复杂依赖（pg/walking-skeleton.service/super-admin 等）
vi.mock('./cs-config-guard', () => ({
  requireCsWriteAccess: vi.fn(() => vi.fn()),
}));

import { requireCsWriteAccess, bodyWechatIdToParam } from './auth';

function mkReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mkRes(): Response {
  return {} as Response;
}

describe('middleware/auth — 导出契约', () => {
  it('requireCsWriteAccess 已导出且为函数', () => {
    expect(typeof requireCsWriteAccess).toBe('function');
  });

  it('bodyWechatIdToParam 已导出且为函数', () => {
    expect(typeof bodyWechatIdToParam).toBe('function');
  });
});

describe('bodyWechatIdToParam — wechat_id 映射到 params.wechatId', () => {
  it('正常 wechat_id → req.params.wechatId 赋值', () => {
    const req = mkReq({ body: { wechat_id: 'cs_abc123' } });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(req.params.wechatId).toBe('cs_abc123');
  });

  it('wechat_id 带首尾空白 → trim 后写入', () => {
    const req = mkReq({ body: { wechat_id: '  cs_trimmed  ' } });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(req.params.wechatId).toBe('cs_trimmed');
  });

  it('body 无 wechat_id → params.wechatId 为空字符串', () => {
    const req = mkReq({ body: {} });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(req.params.wechatId).toBe('');
  });

  it('wechat_id 为非字符串（number）→ params.wechatId 为空字符串', () => {
    const req = mkReq({ body: { wechat_id: 12345 } });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(req.params.wechatId).toBe('');
  });

  it('body 为 null/undefined → params.wechatId 为空字符串，不抛错', () => {
    const req = mkReq({ body: null as unknown as Record<string, unknown> });
    const next: NextFunction = vi.fn();
    expect(() => bodyWechatIdToParam(req, mkRes(), next)).not.toThrow();
    expect(req.params.wechatId).toBe('');
  });

  it('总是调用 next()', () => {
    const req = mkReq({ body: { wechat_id: 'cs_x' } });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('保留 params 中已有的其他字段', () => {
    const req = mkReq({
      body: { wechat_id: 'cs_y' },
      params: { existingKey: 'existingValue' } as Record<string, string>,
    });
    const next: NextFunction = vi.fn();
    bodyWechatIdToParam(req, mkRes(), next);
    expect(req.params.wechatId).toBe('cs_y');
    expect((req.params as Record<string, string>).existingKey).toBe('existingValue');
  });
});
