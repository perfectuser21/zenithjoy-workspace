/**
 * crm friend-scan ingest 对账 + ClawBot 默认黑名单 + self_name 跳过（mock pool）。
 * 端到端真删由 staging 手验（CRM_RECONCILE_DRYRUN=false 跑 force-scan）覆盖。
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
const CS = 'wx_cs_unit';
const ADMIN_EMAIL = 'boss@unit.test';
let app: express.Application;
const OLD_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN;
const OLD_EMAILS = process.env.ADMIN_EMAILS;
const OLD_DRYRUN = process.env.CRM_RECONCILE_DRYRUN;

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
  if (OLD_DRYRUN === undefined) delete process.env.CRM_RECONCILE_DRYRUN;
  else process.env.CRM_RECONCILE_DRYRUN = OLD_DRYRUN;
});
beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockValidateLicense.mockReset();
  delete process.env.CRM_RECONCILE_DRYRUN; // 默认干跑
});

/** 事务 client：BEGIN / 每 contact upsert / onboarding / 对账 UPDATE / COMMIT。
 *  upsertCount = 本次 contact 行数；reconcileRows = 对账 UPDATE 的 RETURNING 行。 */
function mockTxClient(upsertCount: number, reconcileRows: Array<Record<string, unknown>> = []) {
  const clientQuery = vi.fn();
  clientQuery.mockResolvedValueOnce({}); // BEGIN
  for (let i = 0; i < upsertCount; i++)
    clientQuery.mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 });
  clientQuery.mockResolvedValueOnce({}); // onboarding upsert
  clientQuery.mockResolvedValueOnce({ rows: reconcileRows, rowCount: reconcileRows.length }); // 对账（onboarding 之后）
  clientQuery.mockResolvedValueOnce({}); // COMMIT
  mockConnect.mockResolvedValueOnce({ query: clientQuery, release: vi.fn() });
  return clientQuery;
}
function ingest(body: unknown) {
  return request(app)
    .post('/api/crm/friend-scan/ingest')
    .set('X-User-Email', ADMIN_EMAIL)
    .send(body as object);
}
function reconcileCall(clientQuery: ReturnType<typeof vi.fn>) {
  return clientQuery.mock.calls.find(
    (c) => typeof c[0] === 'string' && c[0].includes('scan_miss_count = scan_miss_count + 1'),
  );
}
function upsertCalls(clientQuery: ReturnType<typeof vi.fn>) {
  return clientQuery.mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.crm_customers'),
  );
}

describe('ingest 对账', () => {
  it('非空扫描 → 跑对账 UPDATE，带 present 名单/dryrun/K 参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []);
    const res = await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(200);
    const call = reconcileCall(cq);
    expect(call).toBeDefined();
    expect(call?.[0]).toContain("source = 'scan'");
    expect(call?.[0]).toContain('deleted_at IS NULL');
    expect(call?.[0]).toContain('contact <> ALL');
    const params = call?.[1] as unknown[];
    expect(params).toContain(true); // dryrun 默认
    expect(params).toContain(3); // K
    expect(JSON.stringify(params)).toContain('甲');
  });

  it('空扫描 contacts:[] → 不跑对账（避免误删全部）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(0, []);
    const res = await ingest({ cs_wechat_id: CS, contacts: [] });
    expect(res.status).toBe(200);
    expect(res.body.scanned_count).toBe(0);
    expect(reconcileCall(cq)).toBeUndefined();
  });

  it('真模式 CRM_RECONCILE_DRYRUN=false → 对账 SQL 含 now() 满 K 软删，参数 dryrun=false', async () => {
    process.env.CRM_RECONCILE_DRYRUN = 'false';
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, [
      { contact: '旧群', scan_miss_count: 3, deleted_at: '2026-06-26T00:00:00Z' },
    ]);
    const res = await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(200);
    const call = reconcileCall(cq);
    expect(call?.[0]).toContain('now()');
    expect(call?.[0]).toContain('>=');
    expect(call?.[1] as unknown[]).toContain(false); // dryrun=false
  });
});

describe('ClawBot 默认黑名单 + self_name 跳过', () => {
  it('contact=微信ClawBot → INSERT 带 identity，值为 blacklist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []);
    await ingest({ cs_wechat_id: CS, contacts: [{ name: '微信ClawBot' }] });
    const upsert = upsertCalls(cq)[0];
    expect(upsert?.[0]).toContain('identity');
    expect(upsert?.[1] as unknown[]).toContain('blacklist');
  });

  it('普通 contact → INSERT identity 参数为 customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []);
    await ingest({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    const upsert = upsertCalls(cq)[0];
    expect(upsert?.[1] as unknown[]).toContain('customer');
  });

  it('self_name 与某 contact 同名 → 该 contact 不入册（ingested 不计它）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    const cq = mockTxClient(1, []); // 只剩 1 个真 contact 被 upsert
    const res = await ingest({
      cs_wechat_id: CS,
      self_name: '徐先生企业自媒体-Ai助力',
      contacts: [{ name: '甲' }, { name: '徐先生企业自媒体-Ai助力' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.ingested).toBe(1);
    const ups = upsertCalls(cq);
    expect(ups.length).toBe(1);
    expect(JSON.stringify(ups[0]?.[1])).toContain('甲');
    expect(JSON.stringify(ups[0]?.[1])).not.toContain('Ai助力');
  });
});
