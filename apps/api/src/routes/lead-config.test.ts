/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * lead-config router — unit tests
 *
 * 覆盖：
 *  [SELF] GET /self 带 tenantId header → 用 session tenant 调 fetchLeadConfig，返 200
 *  [SELF] GET /self 无 tenant 上下文 → 401（不是 500，不崩）
 *  [GUARD] GET /self 不把字符串 "self" 当 tenantId 传进 fetchLeadConfig（防回归）
 *
 * Mock 策略：与 agent-burner.test.ts 同款
 *   vi.mock('../db/connection')           — 切断真实 DB
 *   vi.mock('../middleware/tenant-context') — x-test-tenant-id header → req.tenantId；无则 401
 *   vi.mock('../services/feishu-bitable-multitenant') — fetchLeadConfig spy
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

// Mock tenantContext：有 x-test-tenant-id 就注入，没有就返回 401
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) {
      req.tenantId = t;
      return next();
    }
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '未登录' },
      timestamp: new Date().toISOString(),
    });
  },
}));

const mockFetchLeadConfig = vi.fn();
vi.mock('../services/feishu-bitable-multitenant', () => ({
  fetchLeadConfig: (...args: any[]) => mockFetchLeadConfig(...args),
}));

// 懒加载 router（必须在 vi.mock 之后）
async function buildApp() {
  const { default: router } = await import('./lead-config');
  const app = express();
  app.use(express.json());
  app.use('/api/lead-config', router);
  return app;
}

const TEST_TENANT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('GET /api/lead-config/self', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('[SELF] 带 tenantId header → fetchLeadConfig 用该 UUID 调用，返 200', async () => {
    const mockData = { profile: { industry: '美食' }, videos: [] };
    mockFetchLeadConfig.mockResolvedValueOnce(mockData);

    const res = await request(app)
      .get('/api/lead-config/self')
      .set('x-test-tenant-id', TEST_TENANT_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(mockData);

    // fetchLeadConfig 必须以 TEST_TENANT_ID 调用，不能以 "self" 调用
    expect(mockFetchLeadConfig).toHaveBeenCalledTimes(1);
    expect(mockFetchLeadConfig).toHaveBeenCalledWith(TEST_TENANT_ID);
    expect(mockFetchLeadConfig).not.toHaveBeenCalledWith('self');
  });

  it('[SELF] 无 tenant 上下文 → 401，不是 500，不崩', async () => {
    const res = await request(app).get('/api/lead-config/self');
    // 不带 x-test-tenant-id header

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    // fetchLeadConfig 不应被调用
    expect(mockFetchLeadConfig).not.toHaveBeenCalled();
  });

  it('[GUARD] "self" 字符串绝不进入 fetchLeadConfig 参数（防 UUID 列 500 回归）', async () => {
    const mockData = { profile: {}, videos: [] };
    mockFetchLeadConfig.mockResolvedValueOnce(mockData);

    await request(app)
      .get('/api/lead-config/self')
      .set('x-test-tenant-id', TEST_TENANT_ID);

    const calls = mockFetchLeadConfig.mock.calls;
    for (const args of calls) {
      expect(args[0]).not.toBe('self');
    }
  });

  it('[SELF] fetchLeadConfig 抛 BITABLE_NOT_FOUND → 400', async () => {
    const err = Object.assign(new Error('bitable not found'), {
      code: 'BITABLE_NOT_FOUND',
    });
    mockFetchLeadConfig.mockRejectedValueOnce(err);

    const res = await request(app)
      .get('/api/lead-config/self')
      .set('x-test-tenant-id', TEST_TENANT_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BITABLE_NOT_FOUND');
  });

  it('[SELF] fetchLeadConfig 抛 TOKEN_REFRESH_FAILED → 401', async () => {
    const err = Object.assign(new Error('token refresh failed'), {
      code: 'TOKEN_REFRESH_FAILED',
    });
    mockFetchLeadConfig.mockRejectedValueOnce(err);

    const res = await request(app)
      .get('/api/lead-config/self')
      .set('x-test-tenant-id', TEST_TENANT_ID);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REFRESH_FAILED');
  });
});
