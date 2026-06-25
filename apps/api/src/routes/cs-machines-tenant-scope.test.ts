/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 per-operator — GET /api/wechat/cs/machines 按账号租户 scope（钉死「乱列表」修复）
 *
 * 用户原话：该只显示当前账号那台客服机，别一堆乱七八糟（全平台 20 台含 E2E 测试机全列）。
 * 原实现 `async (_req,res)` 没读请求者身份 → listAllMachines() 无 scope 返全部。
 * 本测试钉死：
 *  1. 普通租户运营 → listAllMachines(req.tenantId) 被调用，**只列自己租户的客服机**（带 tenantId）。
 *  2. 超管（X-Bypass-Tenant 通道，无 req.tenantId）→ 旁路，列全部（tenantId=undefined）。
 *  3. 未登录 → 401，不查库。
 *
 * Mock：cs-account-config-store（断言 listAllMachines 收到的 tenantId 参数）+ cs-config-guard 鉴权中间件。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockListAllMachines, mockListPendingMachines } = vi.hoisted(() => ({
  mockListAllMachines: vi.fn(),
  mockListPendingMachines: vi.fn(),
}));

vi.mock('../services/wechat/cs-account-config-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/wechat/cs-account-config-store')>();
  return {
    ...actual,
    listAllMachines: mockListAllMachines,
    listPendingMachines: mockListPendingMachines,
  };
});

/** Mock 鉴权中间件：x-test-tenant-id → 普通运营；x-test-super-admin → 超管(无 tenantId)；都没 → 401。 */
vi.mock('../middleware/cs-config-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/cs-config-guard')>();
  const inject = (req: any, res: any, next: any) => {
    if (req.headers['x-test-super-admin'] === 'true') {
      req.tenantRole = 'super-admin';
      return next();
    }
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) {
      req.tenantId = t;
      req.tenantRole = 'owner';
      return next();
    }
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'no session (mock)' },
      timestamp: new Date().toISOString(),
    });
  };
  return { ...actual, requireCsReadAccess: inject, requireCsWriteAccess: () => inject };
});

import { wechatConfigRouter } from './wechat-config';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wechat', wechatConfigRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/wechat/cs/machines — 按账号租户 scope', () => {
  it('普通运营 → 只列自己租户的客服机（listAllMachines 收到 tenantId）', async () => {
    mockListAllMachines.mockResolvedValue([
      { machine_id: 'm1', wechat_id: 'cs-07c37bd4', self_name: '小苏', configured: true },
    ]);
    const app = buildApp();
    const r = await request(app).get('/api/wechat/cs/machines').set('x-test-tenant-id', TENANT);

    expect(r.status).toBe(200);
    expect(r.body.machines).toHaveLength(1);
    // 关键：带着请求者 tenantId 去 scope，而不是裸调拉全部
    expect(mockListAllMachines).toHaveBeenCalledTimes(1);
    expect(mockListAllMachines.mock.calls[0][0]).toBe(TENANT);
  });

  it('超管（X-Bypass-Tenant 通道，无 tenantId）→ 旁路列全部（tenantId=undefined）', async () => {
    mockListAllMachines.mockResolvedValue([{ machine_id: 'm1' }, { machine_id: 'm2' }]);
    const app = buildApp();
    const r = await request(app).get('/api/wechat/cs/machines').set('x-test-super-admin', 'true');

    expect(r.status).toBe(200);
    expect(mockListAllMachines).toHaveBeenCalledTimes(1);
    expect(mockListAllMachines.mock.calls[0][0]).toBeUndefined();
  });

  it('未登录 → 401，不查库', async () => {
    const app = buildApp();
    const r = await request(app).get('/api/wechat/cs/machines');
    expect(r.status).toBe(401);
    expect(mockListAllMachines).not.toHaveBeenCalled();
  });
});
