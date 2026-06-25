/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 CRM 标身份入口 — PUT /api/crm/customers/identity（地基 D）
 *
 * 现状：identity 列 + internal 排除已上线（PR#892），但只有手动 seed，没有「运营标身份」的入口。
 * 本端点补齐入口：运营在客户列表页把某行身份改成 客户(customer)/黑名单(blacklist)/内部人员(internal)，
 * 写 crm_customers.identity。复用 status/manage 端点同款闸：
 *   - bodyWechatIdToParam + requireCsWriteAccess('wechatId')（per-operator 写权限）
 *   - resolveTenantId（租户隔离：req.tenantId 优先，否则按 cs_wechat_id 反查 service_agents）
 *   - identity 三态校验（customer/blacklist/internal，钉死与 DB CHECK 一致）
 *
 * 钉死契约：
 *   1. 合法三态 → 200 + UPSERT crm_customers.identity（带 tenant_id 隔离）。
 *   2. 非法 identity → 400，不写库。
 *   3. 缺 wechat_id / contact → 400。
 *   4. 解析不到租户 → 404 TARGET_NOT_FOUND（deny by default，绝不写库）。
 *
 * Mock：mock pool（query）+ mock cs-config-guard 写闸（按测试头注入 req.tenantId / 模拟 service 通道）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));

/**
 * Mock 写闸：
 *  - x-test-tenant-id 存在 → 普通租户运营：注入 req.tenantId + tenantRole=owner，放行。
 *  - x-test-service: true → service/超管通道：不注入 tenantId（走 resolveTenantId 反查分支）。
 *  - 都没有 → 401。
 */
vi.mock('../middleware/cs-config-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/cs-config-guard')>();
  const inject = (req: any, res: any, next: any) => {
    if (req.headers['x-test-service'] === 'true') return next();
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
  return {
    ...actual,
    requireCsReadAccess: inject,
    requireCsWriteAccess: () => inject,
    requireServiceCredential: inject,
  };
});

import crmRouter from './crm';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const CS_WECHAT = 'cs-07c37bd4';
const CONTACT = '客户甲';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
  return app;
}

function putIdentity(app: express.Application, body: unknown, tenantHeader = true) {
  const r = request(app).put('/api/crm/customers/identity');
  if (tenantHeader) r.set('x-test-tenant-id', TENANT);
  return r.send(body as object);
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('PUT /api/crm/customers/identity — 标身份入口（三态写 crm_customers.identity）', () => {
  it.each(['customer', 'blacklist', 'internal'])(
    '合法三态 identity=%s → 200 + UPSERT 写 crm_customers.identity（带 tenant_id 隔离）',
    async (identity) => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // UPSERT
      const app = buildApp();
      const r = await putIdentity(app, { wechat_id: CS_WECHAT, contact: CONTACT, identity });

      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ success: true, identity });

      // UPSERT SQL 写 identity 列，参数带 tenant（租户隔离）+ identity 值
      const call = mockQuery.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
      );
      expect(call).toBeDefined();
      expect(call?.[0]).toContain('identity');
      const params = call?.[1] as unknown[];
      expect(params).toContain(TENANT);
      expect(params).toContain(CS_WECHAT);
      expect(params).toContain(CONTACT);
      expect(params).toContain(identity);
    },
  );

  it('非法 identity → 400，且绝不写库', async () => {
    const app = buildApp();
    const r = await putIdentity(app, { wechat_id: CS_WECHAT, contact: CONTACT, identity: 'vip' });
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缺 contact → 400', async () => {
    const app = buildApp();
    const r = await putIdentity(app, { wechat_id: CS_WECHAT, identity: 'customer' });
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缺 wechat_id → 400', async () => {
    const app = buildApp();
    const r = await putIdentity(app, { contact: CONTACT, identity: 'customer' });
    expect(r.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('未登录（无 tenant、非 service）→ 401，不写库', async () => {
    const app = buildApp();
    const r = await request(app)
      .put('/api/crm/customers/identity')
      .send({ wechat_id: CS_WECHAT, contact: CONTACT, identity: 'internal' });
    expect(r.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('service 通道（无 tenantId）解析不到所属租户 → 404 TARGET_NOT_FOUND，绝不写库', async () => {
    // resolveTenantId 反查 service_agents → 空
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const app = buildApp();
    const r = await request(app)
      .put('/api/crm/customers/identity')
      .set('x-test-service', 'true')
      .send({ wechat_id: 'unknown-cs', contact: CONTACT, identity: 'internal' });

    expect(r.status).toBe(404);
    expect(r.body?.error?.code).toBe('TARGET_NOT_FOUND');
    // 只发生了反查，没有 UPSERT
    const upsert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
    );
    expect(upsert).toBeUndefined();
  });

  it('service 通道（无 tenantId）按 cs_wechat_id 反查到租户 → 200 + 用反查租户写库', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }], rowCount: 1 } as any); // resolveTenantId 反查
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // UPSERT
    const app = buildApp();
    const r = await request(app)
      .put('/api/crm/customers/identity')
      .set('x-test-service', 'true')
      .send({ wechat_id: CS_WECHAT, contact: CONTACT, identity: 'internal' });

    expect(r.status).toBe(200);
    const upsert = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
    );
    expect((upsert?.[1] as unknown[])).toContain(TENANT);
  });
});
