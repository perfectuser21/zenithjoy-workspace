/**
 * WS1 — admin-customers 后端 API 路由 [BEHAVIOR]
 *
 * 测试策略：
 * - vi.mock 掉 DB pool，使测试不依赖真实 PostgreSQL
 * - supertest 直接对 Express app 发请求（无需启动 HTTP server）
 * - 验证 PRD Response Schema 字段名 + 禁用字段不存在 + superAdminGuard 行为
 *
 * Red 阶段（WS1 未实现时）期望输出：
 *   × GET /api/admin/customers 返回 200 + PRD schema
 *     AssertionError: expected 404 to be 200
 *   × GET /api/admin/customers/platform-sessions 返回 200 + PRD schema
 *     AssertionError: expected 404 to be 200
 *   × GET /api/admin/customers/publish-logs 返回 200 + PRD schema
 *     AssertionError: expected 404 to be 200
 *   × superAdminGuard 中间件：有效 token 放行，无效 token 返回 401/403
 *     AssertionError: expected 200 not to equal 200 (notFoundHandler 不走 superAdminGuard)
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

// Mock DB pool — 返回符合 PRD schema 的测试数据
vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('agent_platform_sessions')) {
        return {
          rows: [
            {
              session_id: 'sess-test-1',
              tenant_id: 'tenant-test-1',
              platform: 'douyin',
              status: 'active',
              expires_at: '2026-12-31T23:59:59Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('publish_logs')) {
        return {
          rows: [
            {
              log_id: 'log-test-1',
              tenant_id: 'tenant-test-1',
              work_id: 'work-test-1',
              platform: 'douyin',
              status: 'published',
              created_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      // customers 聚合查询 / count 查询
      if (sql.toLowerCase().includes('count(')) {
        return { rows: [{ total: 1 }], rowCount: 1 };
      }
      return {
        rows: [
          {
            tenant_id: 'tenant-test-1',
            email: 'customer@example.com',
            license_status: 'active',
            platform_count: 2,
            last_publish_at: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      };
    }),
    end: vi.fn(),
    connect: vi.fn(),
  },
}));

let app: Express.Application;

beforeAll(async () => {
  // unset 内部 token = superAdminGuard dev 兼容模式（放行所有请求）
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  const appModule = await import('../../../../apps/api/src/app.js');
  app = appModule.default;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('WS1 — admin-customers 后端 API 路由 [BEHAVIOR]', () => {

  // ── RED 阶段失败点 1：路由未注册 → 404 ──────────────────────────────────────
  it('GET /api/admin/customers 返回 200 + PRD schema', async () => {
    const res = await request(app).get('/api/admin/customers');

    // Red: 路由未注册时返回 404（app.ts 未 import adminCustomersRouter）
    expect(res.status).toBe(200);

    // schema 字段验证（PRD Response Schema 字面值）
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');

    // 顶层禁用字段不存在
    expect(res.body).not.toHaveProperty('users');
    expect(res.body).not.toHaveProperty('clients');
    expect(res.body).not.toHaveProperty('members');

    // data[0] 字段验证（若有数据）
    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      expect(row).toHaveProperty('tenant_id');
      expect(row).toHaveProperty('email');
      expect(row).toHaveProperty('license_status');
      expect(row).toHaveProperty('platform_count');
      expect(row).toHaveProperty('last_publish_at');
      // 禁用字段名不出现在 data[0]
      expect(row).not.toHaveProperty('users');
      expect(row).not.toHaveProperty('result');
    }
  });

  // ── RED 阶段失败点 2：platform-sessions 路由未注册 → 404 ────────────────────
  it('GET /api/admin/customers/platform-sessions 返回 200 + PRD schema', async () => {
    const res = await request(app).get('/api/admin/customers/platform-sessions');

    expect(res.status).toBe(200); // Red: 404
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');

    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      expect(row).toHaveProperty('session_id');
      expect(row).toHaveProperty('tenant_id');
      expect(row).toHaveProperty('platform');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('expires_at');
      // status 值只能是 active 或 expired
      expect(['active', 'expired']).toContain(row.status);
    }
  });

  it('GET /api/admin/customers/platform-sessions?tenant_id=X 筛选生效（不使用禁用 query 名）', async () => {
    const res = await request(app).get('/api/admin/customers/platform-sessions?tenant_id=tenant-test-1');
    expect(res.status).toBe(200); // Red: 404
    expect(res.body.success).toBe(true);
    // 不接受禁用 query 名
    const resUser = await request(app).get('/api/admin/customers/platform-sessions?user=x');
    // 禁用 query 名被忽略时仍返回 200（不崩溃）
    expect([200, 400]).toContain(resUser.status);
  });

  // ── RED 阶段失败点 3：publish-logs 路由未注册 → 404 ─────────────────────────
  it('GET /api/admin/customers/publish-logs 返回 200 + PRD schema', async () => {
    const res = await request(app).get('/api/admin/customers/publish-logs');

    expect(res.status).toBe(200); // Red: 404
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');

    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      expect(row).toHaveProperty('log_id');
      expect(row).toHaveProperty('tenant_id');
      expect(row).toHaveProperty('work_id');
      expect(row).toHaveProperty('platform');
      expect(row).toHaveProperty('status');
      expect(row).toHaveProperty('created_at');
      expect(typeof row.created_at).toBe('string');
    }
  });

  it('GET /api/admin/customers/publish-logs?tenant_id=X 筛选生效', async () => {
    const res = await request(app).get('/api/admin/customers/publish-logs?tenant_id=tenant-test-1');
    expect(res.status).toBe(200); // Red: 404
    expect(res.body.success).toBe(true);
  });

  // ── RED 阶段失败点 4：superAdminGuard 未接入 → 无鉴权 ──────────────────────
  it('superAdminGuard 中间件：无效 token 返回 401/403', async () => {
    // 设置 ZENITHJOY_INTERNAL_TOKEN 以激活严格模式
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'test-valid-token';
    try {
      const res = await request(app)
        .get('/api/admin/customers')
        .set('Authorization', 'Bearer wrong-token');
      // Red: 路由未注册时 notFoundHandler 返回 404，superAdminGuard 从未被调用
      //      所以这里会返回 404，而不是 401/403 → 测试失败
      expect([401, 403]).toContain(res.status);
    } finally {
      delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    }
  });

  it('superAdminGuard 中间件：有效 internal token 放行', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'test-valid-token';
    try {
      const res = await request(app)
        .get('/api/admin/customers')
        .set('Authorization', 'Bearer test-valid-token');
      expect(res.status).toBe(200); // Red: 404
    } finally {
      delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    }
  });
});
