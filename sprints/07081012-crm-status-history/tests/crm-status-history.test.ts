/**
 * CRM Status History — Contract Tests
 * Sprint: 07081012-crm-status-history
 *
 * 这是 Red 阶段测试文件：在实现完成之前所有用例应当 FAIL。
 * 每个 it() 对应一条 [BEHAVIOR] 合同条目。
 *
 * 测试模式：vitest + supertest + vi.mock(pool)
 * mock pool.connect() 返回模拟事务客户端，验证事务顺序与历史写入条件。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock DB pool（含事务客户端）
// ---------------------------------------------------------------------------

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn().mockResolvedValue(mockClient);

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: {
    query: mockPoolQuery,
    connect: mockPoolConnect,
  },
}));

// Mock resolveTenantId — 返回固定租户 UUID
vi.mock('../../../apps/api/src/routes/crm', async (importOriginal) => {
  // 不 mock 整个路由，只 mock pool；路由本身 import 原始实现以触发真实逻辑
  return importOriginal();
});

// ---------------------------------------------------------------------------
// 辅助：构建最简 express app，仅挂 crm 路由
// ---------------------------------------------------------------------------

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());

  // 动态 import 路由（在 vi.mock 之后）
  const { default: crmRouter } = await import('../../../apps/api/src/routes/crm');
  app.use('/api/crm', crmRouter);

  return app;
}

// ---------------------------------------------------------------------------
// 请求体工厂
// ---------------------------------------------------------------------------

function statusBody(overrides: Record<string, string> = {}) {
  return {
    wechat_id: 'test-wechat-001',
    contact: 'test-contact',
    status: 'A2',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('CRM Status History — Contract Tests', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-02] 新客户首次写 status → 历史表出现 old_status=NULL 记录
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-02] 新客户首次写 status：历史表写入 old_status=NULL 记录', async () => {
    // resolveTenantId 内部用 pool.query（读），返回租户
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'tenant-uuid-001' }],
    });

    // 事务：BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    // SELECT old_status — 新客户，rows 为空
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // upsert crm_customers
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT history（old_status=NULL，new_status='A2'）
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/crm/customers/status')
      .send(statusBody({ status: 'A2' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'A2' });

    // 验证 INSERT history 被调用，且参数含 old_status=NULL
    const allCalls = mockClientQuery.mock.calls;
    const historyInsert = allCalls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toLowerCase().includes('crm_customer_status_history') &&
        sql.toLowerCase().includes('insert'),
    );
    expect(historyInsert).toBeDefined();
    // 参数中第4个应为 NULL（old_status）
    const params = historyInsert?.[1] as unknown[];
    const oldStatusIdx = params?.findIndex((p) => p === null);
    expect(oldStatusIdx).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-03] 已有客户 status 变化 → 历史表新增对应记录
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-03] 已有客户 status 从 A2 → A3：历史表写入 old_status=A2 记录', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'tenant-uuid-001' }],
    });

    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT old_status — 已有客户，old='A2'
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: 'A2' }] });
    // upsert
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT history with old='A2', new='A3'
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/crm/customers/status')
      .send(statusBody({ status: 'A3' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'A3' });

    const allCalls = mockClientQuery.mock.calls;
    const historyInsert = allCalls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toLowerCase().includes('crm_customer_status_history') &&
        sql.toLowerCase().includes('insert'),
    );
    expect(historyInsert).toBeDefined();
    const params = historyInsert?.[1] as string[];
    // old_status='A2', new_status='A3'
    expect(params).toContain('A2');
    expect(params).toContain('A3');
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-04] 重复提交相同 status → 历史表不新增记录
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-04] 重复提交相同 status A3：历史表不写入新记录', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'tenant-uuid-001' }],
    });

    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT old_status — 已有客户，old='A3'（与 new 相同）
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: 'A3' }] });
    // upsert（仍执行，updated_at 刷新）
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // 注意：不应调用 INSERT history
    // COMMIT
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/crm/customers/status')
      .send(statusBody({ status: 'A3' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'A3' });

    // 验证没有调用 INSERT history
    const allCalls = mockClientQuery.mock.calls;
    const historyInsert = allCalls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toLowerCase().includes('crm_customer_status_history') &&
        sql.toLowerCase().includes('insert'),
    );
    expect(historyInsert).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-05] upsert 失败时历史表不残留记录（事务回滚）
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-05] upsert 抛异常：执行 ROLLBACK，接口返回 500，历史表不残留', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'tenant-uuid-001' }],
    });

    // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] });
    // SELECT old_status
    mockClientQuery.mockResolvedValueOnce({ rows: [{ status: 'A1' }] });
    // upsert 抛异常
    mockClientQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    // ROLLBACK
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/crm/customers/status')
      .send(statusBody({ status: 'A2' }));

    expect(res.status).toBe(500);

    // 验证 ROLLBACK 被调用
    const allCalls = mockClientQuery.mock.calls;
    const rollbackCall = allCalls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.trim().toUpperCase() === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();

    // 验证 INSERT history 未被调用（事务在 upsert 前/中已失败）
    const historyInsert = allCalls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.toLowerCase().includes('crm_customer_status_history') &&
        sql.toLowerCase().includes('insert'),
    );
    expect(historyInsert).toBeUndefined();

    // 验证 client.release() 被调用（连接无泄漏）
    expect(mockClientRelease).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-06] COMMIT 顺序正确：BEGIN → SELECT → upsert → INSERT history → COMMIT
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-06] 事务调用顺序：BEGIN → SELECT → upsert → INSERT history → COMMIT', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ id: 'tenant-uuid-001' }],
    });

    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT old_status（新客户，无行）
      .mockResolvedValueOnce({ rows: [] }) // upsert
      .mockResolvedValueOnce({ rows: [] }) // INSERT history
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await request(app)
      .put('/api/crm/customers/status')
      .send(statusBody({ status: 'A1' }));

    const sqls = mockClientQuery.mock.calls.map(([sql]: [string]) =>
      typeof sql === 'string' ? sql.trim().toUpperCase().split(/\s+/)[0] : '',
    );

    const beginIdx = sqls.indexOf('BEGIN');
    const selectIdx = sqls.findIndex((s) => s === 'SELECT');
    const insertCustomerIdx = sqls.findIndex(
      (_: string, i: number) =>
        mockClientQuery.mock.calls[i]?.[0]
          ?.toLowerCase()
          .includes('crm_customers') &&
        mockClientQuery.mock.calls[i]?.[0]
          ?.toLowerCase()
          .includes('insert'),
    );
    const insertHistoryIdx = sqls.findIndex(
      (_: string, i: number) =>
        mockClientQuery.mock.calls[i]?.[0]
          ?.toLowerCase()
          .includes('crm_customer_status_history'),
    );
    const commitIdx = sqls.lastIndexOf('COMMIT');

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(beginIdx);
    expect(insertCustomerIdx).toBeGreaterThan(selectIdx);
    expect(insertHistoryIdx).toBeGreaterThan(insertCustomerIdx);
    expect(commitIdx).toBeGreaterThan(insertHistoryIdx);
  });

  // -------------------------------------------------------------------------
  // [BEHAVIOR-01] migration 幂等——由 E2E bash 验证，此处补充结构测试
  // （验证 migration SQL 文件存在且含幂等关键字）
  // -------------------------------------------------------------------------
  it('[BEHAVIOR-01] migration 文件存在且包含幂等 DDL 关键字', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const migrationPath = path.resolve(
      __dirname,
      '../../../apps/api/db/migrations/20260708_120000_crm_status_history.sql',
    );

    expect(fs.existsSync(migrationPath)).toBe(true);

    const content = fs.readFileSync(migrationPath, 'utf-8');
    // 幂等 DDL：IF NOT EXISTS
    expect(content).toMatch(/IF NOT EXISTS/i);
    // 回填幂等：ON CONFLICT DO NOTHING 或 NOT EXISTS
    expect(content).toMatch(/ON CONFLICT DO NOTHING|NOT EXISTS/i);
    // 历史表名
    expect(content).toMatch(/crm_customer_status_history/i);
  });
});
