/**
 * CRM 客户状态历史追踪 — 路由合同测试（mock pool，不连真库）
 *
 * 覆盖 FR-01 ~ FR-05 + FR-07 六条合同行为：
 *   FR-01: migration 幂等 — 回填重跑历史表行数不变
 *   FR-02: 新客户首次写 status — 历史表出现 old_status=NULL 记录
 *   FR-03: 已有客户 status 变化 — 历史表新增一行 old_status 正确
 *   FR-04: 重复提交相同 status — 历史表不新增记录
 *   FR-05: upsert 失败时历史表无残留（事务回滚）
 *   FR-07: PUT /status 响应格式向前兼容
 *
 * 路由依赖：
 *   - pool.connect() → client（BEGIN/QUERY/COMMIT/ROLLBACK/release）
 *   - requireCsWriteAccess('wechatId') — 网页超管邮箱旁路放行
 *   - resolveTenantId — 内部实现，通过 pool.query mock 控制
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── mock pool（必须在 import 路由前 hoisted）──────────────────────────────────
const { mockPoolQuery, mockConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockConnect: vi.fn(),
}));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockPoolQuery, connect: mockConnect, end: vi.fn() },
}));

// ── 常量 ──────────────────────────────────────────────────────────────────────
const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const CS = 'wx_cs_history_test';
const ADMIN_EMAIL = 'boss@unit.test';
const OLD_EMAILS = process.env.ADMIN_EMAILS;

let app: express.Application;

// ── 工具函数：构造带事务能力的 client mock ────────────────────────────────────
function makeClient(queryResponses: Array<{ rows?: unknown[]; rowCount?: number }>) {
  let callIndex = 0;
  const clientQuery = vi.fn().mockImplementation(() => {
    const resp = queryResponses[callIndex] ?? { rows: [], rowCount: 0 };
    callIndex++;
    return Promise.resolve(resp);
  });
  return {
    query: clientQuery,
    release: vi.fn(),
  };
}

function makeClientWithError(
  queryResponses: Array<{ rows?: unknown[]; rowCount?: number }>,
  failAtIndex: number,
  errorMessage = 'DB_ERROR',
) {
  let callIndex = 0;
  const clientQuery = vi.fn().mockImplementation(() => {
    if (callIndex === failAtIndex) {
      callIndex++;
      return Promise.reject(new Error(errorMessage));
    }
    const resp = queryResponses[callIndex] ?? { rows: [], rowCount: 0 };
    callIndex++;
    return Promise.resolve(resp);
  });
  return {
    query: clientQuery,
    release: vi.fn(),
  };
}

/** 写接口统一带网页超管邮箱头（requireCsWriteAccess 邮箱旁路放行）。 */
function statusReq() {
  return request(app).put('/api/crm/customers/status').set('X-User-Email', ADMIN_EMAIL);
}

// ── 环境准备 ─────────────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  const { default: crmRouter } = await import('../../src/routes/crm');
  app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
});

afterAll(() => {
  if (OLD_EMAILS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = OLD_EMAILS;
});

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockConnect.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-01: migration 幂等 — 回填重跑历史表行数不变
// （此条行为由 migration SQL 的 WHERE NOT EXISTS 守卫保证；
//  在单元测试层面，我们验证 SQL 结构正确性：migration 文件存在且含幂等守卫关键词）
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-01: migration 幂等 — 回填重跑历史表行数不变', () => {
  it('migration 文件存在，且包含 CREATE TABLE IF NOT EXISTS 幂等建表', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const migDir = path.resolve(__dirname, '../../db/migrations');
    const files = fs.readdirSync(migDir);
    const migFile = files.find((f) => f.includes('add_crm_customer_status_history'));
    expect(migFile).toBeDefined();
    const content = fs.readFileSync(path.join(migDir, migFile!), 'utf8');
    expect(content).toContain('CREATE TABLE IF NOT EXISTS');
    expect(content).toContain('crm_customer_status_history');
    // 幂等守卫：回填 INSERT 必须带 WHERE NOT EXISTS
    expect(content).toContain('NOT EXISTS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-02: 新客户首次写 status — 历史表出现 old_status=NULL 记录
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-02: 新客户首次写 status — 历史表出现 old_status=NULL 记录', () => {
  it('PUT /customers/status for new customer inserts history row with old_status=null', async () => {
    // resolveTenantId：pool.query 反查 service_agents → 返回 tenant
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });

    // client 事务调用顺序：
    //   [0] BEGIN
    //   [1] SELECT FOR UPDATE → 新客户，rows 为空
    //   [2] UPSERT crm_customers
    //   [3] INSERT crm_customer_status_history（old_status=NULL → new）
    //   [4] COMMIT
    const client = makeClient([
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SELECT FOR UPDATE → 无旧记录
      { rows: [], rowCount: 1 }, // UPSERT
      { rows: [], rowCount: 1 }, // INSERT history
      { rows: [], rowCount: 0 }, // COMMIT
    ]);
    mockConnect.mockResolvedValue(client);

    const res = await statusReq().send({
      wechat_id: CS,
      contact: '新客户甲',
      status: 'A1',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('A1');

    // 验证事务内确实调用了 INSERT history（第 4 次 query，index=3）
    const historyCalls = client.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('crm_customer_status_history'),
    );
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);

    // 验证历史 INSERT 的参数：old_status 位（$4）为 null
    const historyInsertCall = historyCalls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT'),
    );
    expect(historyInsertCall).toBeDefined();
    // params: [tenantId, csWechatId, contact, oldStatus, newStatus]
    const params = historyInsertCall![1] as unknown[];
    expect(params[3]).toBeNull(); // old_status = NULL
    expect(params[4]).toBe('A1'); // new_status = A1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-03: 已有客户 status 变化 — 历史表新增一行 old_status 正确
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-03: 已有客户 status 变化 — 历史表新增一行 old_status 正确', () => {
  it('PUT /status with changed status inserts history row with correct old_status', async () => {
    // resolveTenantId
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });

    // client 事务：SELECT FOR UPDATE → 返回旧 status='A1'，改为 A2
    const client = makeClient([
      { rows: [], rowCount: 0 },                           // BEGIN
      { rows: [{ status: 'A1' }], rowCount: 1 },           // SELECT FOR UPDATE → old=A1
      { rows: [], rowCount: 1 },                           // UPSERT
      { rows: [], rowCount: 1 },                           // INSERT history
      { rows: [], rowCount: 0 },                           // COMMIT
    ]);
    mockConnect.mockResolvedValue(client);

    const res = await statusReq().send({
      wechat_id: CS,
      contact: '老客户乙',
      status: 'A2',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 验证历史 INSERT 的 old_status=A1, new_status=A2
    const historyInsertCall = client.query.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('crm_customer_status_history'),
    );
    expect(historyInsertCall).toBeDefined();
    const params = historyInsertCall![1] as unknown[];
    expect(params[3]).toBe('A1'); // old_status
    expect(params[4]).toBe('A2'); // new_status
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-04: 重复提交相同 status — 历史表不新增记录
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-04: 重复提交相同 status — 历史表不新增记录', () => {
  it('PUT /status with same status does not insert history row', async () => {
    // resolveTenantId
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });

    // SELECT FOR UPDATE → status='A2'（与请求相同）
    const client = makeClient([
      { rows: [], rowCount: 0 },                         // BEGIN
      { rows: [{ status: 'A2' }], rowCount: 1 },         // SELECT FOR UPDATE → old=A2
      { rows: [], rowCount: 1 },                         // UPSERT（照常执行）
      // 不应有 INSERT history
      { rows: [], rowCount: 0 },                         // COMMIT
    ]);
    mockConnect.mockResolvedValue(client);

    const res = await statusReq().send({
      wechat_id: CS,
      contact: '老客户乙',
      status: 'A2', // 与当前相同
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 验证没有调用 INSERT crm_customer_status_history
    const historyInsertCalls = client.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('crm_customer_status_history'),
    );
    expect(historyInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-05: upsert 失败时历史表无残留（事务回滚）
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-05: upsert 失败时历史表无残留（事务回滚）', () => {
  it('PUT /status rolls back history insert when upsert fails', async () => {
    // resolveTenantId
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });

    // 调用顺序：BEGIN(0), SELECT FOR UPDATE(1), UPSERT(2 → 抛错), ROLLBACK(?)
    // failAtIndex=2 = UPSERT 抛错
    const client = makeClientWithError(
      [
        { rows: [], rowCount: 0 },          // BEGIN
        { rows: [], rowCount: 0 },          // SELECT FOR UPDATE → 新客户
        { rows: [], rowCount: 0 },          // UPSERT（将在此处抛错）
        { rows: [], rowCount: 0 },          // ROLLBACK
      ],
      2, // failAtIndex: UPSERT 抛错
      'DB_UPSERT_FAILED',
    );
    mockConnect.mockResolvedValue(client);

    const res = await statusReq().send({
      wechat_id: CS,
      contact: '测试回滚',
      status: 'A3',
    });

    // 路由应返回 5xx
    expect(res.status).toBe(500);

    // 验证 ROLLBACK 被调用
    const rollbackCalls = client.query.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('ROLLBACK'),
    );
    expect(rollbackCalls.length).toBeGreaterThanOrEqual(1);

    // 验证没有 INSERT crm_customer_status_history
    const historyInsertCalls = client.query.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT') &&
        call[0].includes('crm_customer_status_history'),
    );
    expect(historyInsertCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-07: PUT /status 响应格式向前兼容
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-07: PUT /status 响应格式向前兼容', () => {
  it('PUT /status response shape is unchanged after transaction refactor', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });

    const client = makeClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 }, // 新客户
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    mockConnect.mockResolvedValue(client);

    const res = await statusReq().send({
      wechat_id: CS,
      contact: '格式验证用户',
      status: 'A4',
    });

    expect(res.status).toBe(200);
    // 原响应格式：{ success: true, status: <st> }
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('status', 'A4');
  });
});
