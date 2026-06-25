/**
 * crm 身份标记端点 PUT /api/crm/customers/identity 路由测试（mock pool，不连真库）
 *
 * 口径（lead 拍板 2026-06-25）：
 *   - identity 列 = 名册成员资格单一真相源（customer/blacklist/internal）。
 *   - identity='blacklist' → 写 crm_customers.identity 的同时把 contact 加进 wechat_cs_account_config.blacklist
 *     （让 agent should_reply 真的停回他，回复网关不破）。
 *   - identity='customer' → 写 identity 列 + 从 config.blacklist 移除（恢复接管）。
 *   - identity='internal' → 只写 identity 列，**不碰** config.blacklist（内部人员从列表消失即可；
 *     之前若在 blacklist 里留着无妨——AI 不该回自己人，留着更安全）。
 *
 * 鉴权复用 manage：bodyWechatIdToParam + requireCsWriteAccess('wechatId') + resolveTenantId 同租户隔离。
 * 本测试不设 ZENITHJOY_INTERNAL_TOKEN（dev 放行 service 通道），写接口用网页超管邮箱旁路。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const CS = 'wx_cs_idmark';
const ADMIN_EMAIL = 'boss@unit.test';

let app: express.Application;
const OLD_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN;
const OLD_EMAILS = process.env.ADMIN_EMAILS;

/** 写接口统一带网页超管邮箱头（requireCsWriteAccess 邮箱旁路放行）。 */
function idReq() {
  return request(app).put('/api/crm/customers/identity').set('X-User-Email', ADMIN_EMAIL);
}

beforeAll(async () => {
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  const { default: crmRouter } = await import('../../src/routes/crm');
  app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
});

afterAll(() => {
  if (OLD_TOKEN === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  else process.env.ZENITHJOY_INTERNAL_TOKEN = OLD_TOKEN;
  if (OLD_EMAILS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = OLD_EMAILS;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('PUT /api/crm/customers/identity — 入参校验', () => {
  it('缺 contact → 400', async () => {
    const res = await idReq().send({ wechat_id: CS, identity: 'internal' });
    expect(res.status).toBe(400);
  });

  it('非法 identity 值 → 400（只允许 customer/blacklist/internal）', async () => {
    const res = await idReq().send({ wechat_id: CS, contact: '甲', identity: 'vip' });
    expect(res.status).toBe(400);
  });

  it('解析不到租户 → 404 TARGET_NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // resolveTenantId → 空
    const res = await idReq().send({ wechat_id: 'wx_unknown', contact: '甲', identity: 'internal' });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('TARGET_NOT_FOUND');
  });
});

describe('PUT /api/crm/customers/identity — internal（只写 identity 列，不碰 config.blacklist）', () => {
  it('标 internal → 只 UPDATE crm_customers.identity，不写 wechat_cs_account_config', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 }) // resolveTenantId
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE crm_customers SET identity='internal'
    const res = await idReq().send({ wechat_id: CS, contact: '于瑾', identity: 'internal' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, identity: 'internal' });
    // 断言没有任何一条 SQL 动 wechat_cs_account_config（internal 不碰 config.blacklist）
    const touchedConfig = mockQuery.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes('wechat_cs_account_config'),
    );
    expect(touchedConfig).toBe(false);
    // identity 真写了
    const idWrite = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('crm_customers') && c[0].includes('identity'),
    );
    expect(idWrite).toBeDefined();
    expect(idWrite?.[1]).toContain('internal');
  });
});

describe('PUT /api/crm/customers/identity — blacklist/customer 与 config.blacklist 双向同步', () => {
  it('标 blacklist → 写 identity 列 + 把 contact 加进 config.blacklist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 }) // resolveTenantId
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE crm_customers identity
      .mockResolvedValueOnce({ rows: [{ blacklist: [] }], rowCount: 1 }) // SELECT 现有 blacklist
      .mockResolvedValueOnce({ rowCount: 1 }); // UPSERT config.blacklist 含 contact
    const res = await idReq().send({ wechat_id: CS, contact: '小号A', identity: 'blacklist' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, identity: 'blacklist' });
    // config.blacklist upsert 真发生，且参数里含被拉黑的人
    const cfgUpsert = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_cs_account_config') &&
        c[0].includes('blacklist'),
    );
    expect(cfgUpsert).toBeDefined();
    expect(JSON.stringify(cfgUpsert?.[1])).toContain('小号A');
  });

  it('标 customer → 写 identity 列 + 从 config.blacklist 移除（恢复接管）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 }) // resolveTenantId
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE crm_customers identity
      .mockResolvedValueOnce({ rows: [{ blacklist: ['小号A', '别人'] }], rowCount: 1 }) // SELECT 现有 blacklist
      .mockResolvedValueOnce({ rowCount: 1 }); // UPSERT config.blacklist 去掉 contact
    const res = await idReq().send({ wechat_id: CS, contact: '小号A', identity: 'customer' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, identity: 'customer' });
    const cfgUpsert = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('INSERT INTO zenithjoy.wechat_cs_account_config') &&
        c[0].includes('blacklist'),
    );
    expect(cfgUpsert).toBeDefined();
    // 移除后 blacklist 不再含 小号A，但保留别人
    const payload = JSON.stringify(cfgUpsert?.[1]);
    expect(payload).not.toContain('小号A');
    expect(payload).toContain('别人');
  });
});
