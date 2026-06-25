/**
 * crm 外层表重做：身份三态 + 加微信时间 + 微信号 路由测试（mock pool，不连真库）
 *
 * 覆盖 Track C 契约的 HTTP 行为：
 *   - POST /api/crm/friend-scan/ingest：向前兼容收 contacts[].wechat_id / add_friend_time 并写库；
 *     agent 不传这两个字段也不报错（写 NULL）。
 *   - GET /api/crm/customers：返回行带 add_friend_time + identity；identity='internal' 的行从列表**排除**。
 *
 * 鉴权：ingest 走 requireServiceCredential（本测试不设 ZENITHJOY_INTERNAL_TOKEN → dev 放行）；
 * GET customers 走 requireCsReadAccess（X-User-Email ∈ ADMIN_EMAILS 邮箱超管旁路 + 显式 cs_wechat_id 走 super-admin）。
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect, mockValidateLicense } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
  mockValidateLicense: vi.fn(),
}));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));
vi.mock('../../src/services/walking-skeleton.service', () => ({
  validateLicense: mockValidateLicense,
}));

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const CS = 'wx_cs_identity';
const ADMIN_EMAIL = 'boss@unit.test';

let app: express.Application;
const OLD_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN;
const OLD_EMAILS = process.env.ADMIN_EMAILS;

beforeAll(async () => {
  delete process.env.ZENITHJOY_INTERNAL_TOKEN; // dev 放行 service 通道（ingest 不带 token）
  process.env.ADMIN_EMAILS = ADMIN_EMAIL; // GET customers 邮箱超管旁路
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
  mockValidateLicense.mockReset();
});

describe('POST /api/crm/friend-scan/ingest — 向前兼容收 wechat_id + add_friend_time', () => {
  it('带 wechat_id + add_friend_time → upsert SQL 把两字段写进库（200）', async () => {
    // resolveServiceWriteTenant: resolveTenantId 反查 service_agents → TENANT_A
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const clientQuery = vi.fn();
    clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 }) // upsert contact
      .mockResolvedValueOnce({}) // onboarding upsert
      .mockResolvedValueOnce({}); // COMMIT
    mockConnect.mockResolvedValueOnce({ query: clientQuery, release: vi.fn() });

    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .send({
        cs_wechat_id: CS,
        contacts: [
          {
            name: '甲',
            wechat_id: 'wxid_jiaa',
            add_friend_time: '2026-06-01T03:00:00.000Z',
            last_message: '在吗',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, ingested: 1 });

    // 断言 upsert crm_customers 的 SQL 列含 wechat_id + add_friend_time，且参数带上两值
    const upsertCall = clientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall?.[0]).toContain('wechat_id');
    expect(upsertCall?.[0]).toContain('add_friend_time');
    const params = upsertCall?.[1] as unknown[];
    expect(params).toContain('wxid_jiaa');
    expect(params).toContain('2026-06-01T03:00:00.000Z');
  });

  it('agent 不传 wechat_id / add_friend_time → 写 NULL，不报错（200）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const clientQuery = vi.fn();
    clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockConnect.mockResolvedValueOnce({ query: clientQuery, release: vi.fn() });

    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .send({ cs_wechat_id: CS, contacts: [{ name: '乙', last_message: '你好' }] });

    expect(res.status).toBe(200);
    const upsertCall = clientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
    );
    const params = upsertCall?.[1] as unknown[];
    // 缺省两字段落 null（不抛错）
    expect(params).toContain(null);
  });
});

describe('GET /api/crm/customers — 返回 identity + add_friend_time 且排除 internal', () => {
  function adminGet() {
    // super-admin 旁路：邮箱超管头 + 显式 cs_wechat_id（决策5）
    return request(app)
      .get('/api/crm/customers')
      .set('X-User-Email', ADMIN_EMAIL)
      .query({ cs_wechat_id: CS });
  }

  it('行带 add_friend_time + identity 字段；identity=internal 的行被排除', async () => {
    // 1) resolveReadScope（super-admin 分支）: service_agents 反查租户 → TENANT_A
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    // 2) cs_memory_messages 聚合 → 空
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // 3) crm_customers 查询 → 三行：客户甲(customer) / 内部丙(internal) / 客户乙(customer)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          contact: '客户甲',
          wechat_id: 'wxid_a',
          status: 'A1',
          source: 'scan',
          last_message: '在吗',
          last_seen_at: '2026-06-20T00:00:00.000Z',
          add_friend_time: '2026-06-01T00:00:00.000Z',
          identity: 'customer',
        },
        {
          contact: '内部丙',
          wechat_id: 'wxid_c',
          status: 'A1',
          source: 'scan',
          last_message: null,
          last_seen_at: null,
          add_friend_time: '2026-05-01T00:00:00.000Z',
          identity: 'internal',
        },
        {
          contact: '客户乙',
          wechat_id: 'wxid_b',
          status: 'A2',
          source: 'manual',
          last_message: null,
          last_seen_at: null,
          add_friend_time: null,
          identity: 'customer',
        },
      ],
      rowCount: 3,
    });
    // 4) wechat_cs_account_config（whitelist/blacklist/takeover_mode）→ 空
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await adminGet();
    expect(res.status).toBe(200);
    const customers = res.body.customers as Array<Record<string, unknown>>;
    const contacts = customers.map((c) => c.contact);

    // internal 被排除
    expect(contacts).not.toContain('内部丙');
    expect(contacts).toContain('客户甲');
    expect(contacts).toContain('客户乙');

    // 客户甲带 add_friend_time + identity 字段
    const jia = customers.find((c) => c.contact === '客户甲')!;
    expect(jia).toHaveProperty('add_friend_time', '2026-06-01T00:00:00.000Z');
    expect(jia).toHaveProperty('identity', 'customer');
  });
});
