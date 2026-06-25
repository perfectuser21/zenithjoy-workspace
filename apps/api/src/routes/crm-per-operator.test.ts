/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line04 CRM per-operator 重做 — 普通租户运营自动按租户 scope（钉死契约任务2/3）
 *
 * 用户拍板模型：一个 email 账号 → 绑一个租户(+客服机) → 登录后**自动只看自己客户、自己能扫**，
 * 超管跟这个流程半毛钱关系没有。本测试钉死后端这一行为，防止回退到「超管+选机器(决策5)」错方向：
 *
 *  1. 普通运营（非超管：req.tenantId 非空、tenantRole=owner，**不带 cs_wechat_id**）
 *     GET /api/crm/customers → 200，自动 scope 到该租户名下所有客服机，给出客户名册。
 *     断言后端**没有**对普通运营强制 cs_wechat_id（即不会返回 CS_WECHAT_ID_REQUIRED）。
 *  2. 普通运营单客服机时无需挑机器：scope 自动用其唯一客服机的数据。
 *  3. 普通运营 POST /api/crm/friend-scan/trigger（不带超管头）→ 200 ok，能触发立即扫好友
 *     （requireCsReadAccess 含 owner/admin/member 全员可读可触发，不需超管）。
 *  4. 决策5（须显式 cs_wechat_id）**仅超管旁路**：超管（无 tenantId）不带 cs_wechat_id → 400 CS_WECHAT_ID_REQUIRED，
 *     证明该限制没有套到普通运营头上。
 *
 * Mock 策略：mock pool（query/connect）+ mock cs-config-guard 的鉴权中间件（注入 req.tenantId / 模拟超管）。
 * buildCustomerRoster 是纯函数（不连 DB），放真跑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));

/**
 * Mock 鉴权中间件，按测试头模拟两类调用方：
 *  - x-test-tenant-id 存在 → 普通租户运营：注入 req.tenantId + req.tenantRole（默认 owner），放行。
 *  - x-test-super-admin: true → 超管：不注入 tenantId（req.tenantId 留空），放行（走 resolveReadScope 超管分支）。
 *  - 都没有 → 401（模拟未登录）。
 */
vi.mock('../middleware/cs-config-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/cs-config-guard')>();
  const inject = (req: any, res: any, next: any) => {
    if (req.headers['x-test-super-admin'] === 'true') {
      // 超管：无 tenantId（与生产 X-Bypass-Tenant 通道一致：req.tenantId 留空）
      req.tenantRole = 'super-admin';
      return next();
    }
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) {
      req.tenantId = t;
      req.tenantRole = (req.headers['x-test-role'] as string) || 'owner';
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
const CS_WECHAT = 'cs-07c37bd4'; // 单客服机（小苏）

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('GET /api/crm/customers — 普通运营 per-operator 自动 scope（无需超管 / 无需 cs_wechat_id）', () => {
  it('普通运营（owner，不带 cs_wechat_id）→ 200 + 自动按租户 scope 出客户名册', async () => {
    // 1) resolveReadScope：该租户名下客服机（单台）
    mockQuery.mockResolvedValueOnce({ rows: [{ wechat_id: CS_WECHAT }], rowCount: 1 } as any);
    // 2) cs_memory_messages：已聊过的人
    mockQuery.mockResolvedValueOnce({
      rows: [{ contact: '张三', last_contact_at: new Date('2026-06-20T00:00:00Z') }],
      rowCount: 1,
    } as any);
    // 3) crm_customers：手动 + scan
    mockQuery.mockResolvedValueOnce({
      rows: [
        { contact: '李四', wechat_id: null, status: 'A2', source: 'manual', last_message: null, last_seen_at: null, add_friend_time: null },
      ],
      rowCount: 1,
    } as any);
    // 4) crm_internal_staff：内部人员名册（身份三态）
    mockQuery.mockResolvedValueOnce({ rows: [{ name: '徐啸' }], rowCount: 1 } as any);
    // 5) wechat_cs_account_config：接管态
    mockQuery.mockResolvedValueOnce({
      rows: [{ whitelist: [], blacklist: [], takeover_mode: 'blacklist' }],
      rowCount: 1,
    } as any);

    const app = buildApp();
    const r = await request(app).get('/api/crm/customers').set('x-test-tenant-id', TENANT);

    expect(r.status).toBe(200);
    // 没有强制 cs_wechat_id（不会返回该错误码）
    expect(r.body?.error?.code).not.toBe('CS_WECHAT_ID_REQUIRED');
    // 名册聚合出客户（张三 + 李四），且响应体不回泄 tenant_id
    const contacts = (r.body.customers as Array<{ contact: string }>).map((c) => c.contact);
    expect(contacts).toContain('张三');
    expect(contacts).toContain('李四');
    expect(JSON.stringify(r.body)).not.toContain(TENANT);
    // cs_wechat_id 自动用其唯一客服机（前端写接口拿这个 key，不让用户挑）
    expect(r.body.cs_wechat_id).toBe(CS_WECHAT);

    // 关键：resolveReadScope 第一条 SQL 是按 tenant_id 查 service_agents（自动 scope），不是按 cs 反查
    const firstSql = mockQuery.mock.calls[0][0] as string;
    expect(firstSql).toContain('service_agents');
    expect(firstSql).toContain('tenant_id');
    expect(mockQuery.mock.calls[0][1]).toEqual([TENANT]);
  });

  it('未登录（无 tenant、非超管）→ 401（普通运营闸由 requireCsReadAccess 负责）', async () => {
    const app = buildApp();
    const r = await request(app).get('/api/crm/customers');
    expect(r.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('决策5 仅超管旁路：超管不带 cs_wechat_id → 400 CS_WECHAT_ID_REQUIRED（证明没套到普通运营）', async () => {
    const app = buildApp();
    const r = await request(app).get('/api/crm/customers').set('x-test-super-admin', 'true');
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('CS_WECHAT_ID_REQUIRED');
  });
});

describe('POST /api/crm/friend-scan/trigger — 普通运营即可触发立即扫好友（不需超管）', () => {
  it('普通运营（owner）带本租户客服机 → 200 ok + requested_at', async () => {
    // 1) 租户 session 带 cs 校验该 cs 属本租户 → 命中
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as any);
    // 2) INSERT crm_onboarding_state ... RETURNING force_scan_requested_at
    mockQuery.mockResolvedValueOnce({
      rows: [{ force_scan_requested_at: new Date('2026-06-25T10:00:00Z') }],
      rowCount: 1,
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/crm/friend-scan/trigger')
      .set('x-test-tenant-id', TENANT)
      .send({ cs_wechat_id: CS_WECHAT });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.requested_at).toBe('2026-06-25T10:00:00.000Z');
  });

  it('普通运营偷点别家租户的客服机 → 403 CROSS_TENANT（deny by default）', async () => {
    // 租户 session 带 cs 校验该 cs 属本租户 → 不命中（跨租户）
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/crm/friend-scan/trigger')
      .set('x-test-tenant-id', TENANT)
      .send({ cs_wechat_id: 'someone-elses-cs' });

    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('CROSS_TENANT');
  });
});
