/**
 * crm friend-scan trigger/pending 路由测试（立即扫好友）
 *
 * 覆盖 cs-be 新增三件的 HTTP 行为（mock pool，不连真库）：
 *   - POST /api/crm/friend-scan/trigger：设 force_scan_requested_at；缺 cs_wechat_id → 400；
 *     解析不到租户 → 404；租户 session 跨租户 → 403 CROSS_TENANT；成功 → {ok,requested_at}。
 *   - GET  /api/crm/friend-scan/pending：force=true/false 两态；缺 cs_wechat_id → 400；解析不到租户 → 404。
 *   - POST /api/crm/friend-scan/ingest：成功后 onboarding upsert 把 force_scan_requested_at 置 NULL（清标志）。
 *
 * 鉴权：trigger 走 requireCsReadAccess、pending/ingest 走 requireServiceCredential；
 * 本测试不设 ZENITHJOY_INTERNAL_TOKEN（dev 放行），用 X-Internal-Token 头驱动服务通道。
 * 端到端真发（含 DB 真写 + 清标志）另由 line04-crm-blacklist-ingest-onboarding-smoke.sh 在 CI 跑。
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
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const CS = 'wx_cs_unit';
const AGENT_LICENSE = 'ZJ-B-AAAA1111';
// trigger 走 requireCsReadAccess：网页超管经 X-User-Email ∈ ADMIN_EMAILS 旁路放行（修 403 的同一通道）。
const ADMIN_EMAIL = 'boss@unit.test';

let app: express.Application;
const OLD_TOKEN = process.env.ZENITHJOY_INTERNAL_TOKEN;
const OLD_EMAILS = process.env.ADMIN_EMAILS;

/** trigger 请求统一带网页超管邮箱头（requireCsReadAccess 邮箱旁路放行）。 */
function triggerReq() {
  return request(app).post('/api/crm/friend-scan/trigger').set('X-User-Email', ADMIN_EMAIL);
}

beforeAll(async () => {
  // dev 放行 service 通道（pending/ingest，与 agent「未设不带头」对齐）；trigger 用邮箱超管旁路。
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
  mockValidateLicense.mockReset();
});

describe('POST /api/crm/friend-scan/trigger — 立即扫好友（网页用户）', () => {
  it('缺 cs_wechat_id → 400', async () => {
    const res = await triggerReq().send({});
    expect(res.status).toBe(400);
  });

  it('解析不到租户 → 404 TARGET_NOT_FOUND', async () => {
    // resolveTenantId 反查 service_agents → 空
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await triggerReq().send({ cs_wechat_id: 'wx_unknown' });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('TARGET_NOT_FOUND');
  });

  it('邮箱超管（无 req.tenantId）成功 → 200 + {ok,requested_at}', async () => {
    // 1) resolveTenantId 反查 → TENANT_A；2) INSERT...RETURNING force_scan_requested_at
    const ts = '2026-06-25T07:00:00.000Z';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ force_scan_requested_at: ts }], rowCount: 1 });
    const res = await triggerReq().send({ cs_wechat_id: CS });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.requested_at).toBe(ts);
  });

  it('DB 写失败 → 500 TRIGGER_FAILED', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    const res = await triggerReq().send({ cs_wechat_id: CS });
    expect(res.status).toBe(500);
    expect(res.body.error?.code).toBe('TRIGGER_FAILED');
  });
});

describe('GET /api/crm/friend-scan/pending — agent 轮询', () => {
  it('缺 cs_wechat_id → 400', async () => {
    const res = await request(app).get('/api/crm/friend-scan/pending');
    expect(res.status).toBe(400);
  });

  it('解析不到租户 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/crm/friend-scan/pending')
      .query({ cs_wechat_id: 'wx_unknown' });
    expect(res.status).toBe(404);
  });

  it('force_scan_requested_at 非空 → force=true', async () => {
    const ts = '2026-06-25T07:00:00.000Z';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ force_scan_requested_at: ts }], rowCount: 1 });
    const res = await request(app)
      .get('/api/crm/friend-scan/pending')
      .query({ cs_wechat_id: CS });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, force: true, requested_at: ts });
  });

  it('force_scan_requested_at 为空 → force=false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ force_scan_requested_at: null }], rowCount: 1 });
    const res = await request(app)
      .get('/api/crm/friend-scan/pending')
      .query({ cs_wechat_id: CS });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, force: false, requested_at: null });
  });

  it('无 onboarding 行 → force=false（默认无强制请求）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get('/api/crm/friend-scan/pending')
      .query({ cs_wechat_id: CS });
    expect(res.status).toBe(200);
    expect(res.body.force).toBe(false);
  });

  it('DB 查失败 → 500 PENDING_FAILED', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 })
      .mockRejectedValueOnce(new Error('boom'));
    const res = await request(app)
      .get('/api/crm/friend-scan/pending')
      .query({ cs_wechat_id: CS });
    expect(res.status).toBe(500);
    expect(res.body.error?.code).toBe('PENDING_FAILED');
  });
});

describe('POST /api/crm/friend-scan/ingest — 成功后清 force 标志', () => {
  it('ingest 成功 → onboarding upsert 带 force_scan_requested_at=NULL（清标志）', async () => {
    // resolveTenantId（pool.query）→ TENANT_A
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
    // 事务客户端：BEGIN / upsert crm_customers(RETURNING inserted) / onboarding upsert / COMMIT
    const clientQuery = vi.fn();
    clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ inserted: true }], rowCount: 1 }) // upsert contact
      .mockResolvedValueOnce({}) // onboarding upsert（含 force_scan_requested_at=NULL）
      .mockResolvedValueOnce({}); // COMMIT
    mockConnect.mockResolvedValueOnce({ query: clientQuery, release: vi.fn() });

    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .send({ cs_wechat_id: CS, contacts: [{ name: '甲', last_message: '在吗' }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, ingested: 1, scanned_count: 1 });
    // 断言 onboarding upsert SQL 真的把 force_scan_requested_at 置 NULL（清标志契约）。
    const onboardingCall = clientQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('crm_onboarding_state'),
    );
    expect(onboardingCall).toBeDefined();
    expect(onboardingCall?.[0]).toContain('force_scan_requested_at = NULL');
  });
});

// ─── Gap1：真 agent（只有 license、无 internal token）扫好友能写进 CRM ───
// 生产环境 ZENITHJOY_INTERNAL_TOKEN 已设 → 不带 token 的 agent 原本 401。
// 修复后：agent 带 X-License-Key 自证 → requireServiceCredential 校验 license→tenant，挂 req.tenantId，
// handler 校验 cs_wechat_id 属该 tenant 后放行写库。跨租户 cs_wechat_id → 403。
describe('Gap1 — agent license 自证 ingest（生产 internal token 已设，agent 只有 license）', () => {
  const OLD = process.env.ZENITHJOY_INTERNAL_TOKEN;
  beforeEach(() => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'svc-tok-prod';
  });
  afterAll(() => {
    if (OLD === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    else process.env.ZENITHJOY_INTERNAL_TOKEN = OLD;
  });

  it('真 agent 无 internal token 但带 X-License-Key → 扫好友写进 crm_customers（200）', async () => {
    // requireServiceCredential 校验 license → tenant_id=TENANT_A，挂 req.tenantId。
    mockValidateLicense.mockResolvedValue({
      ok: true,
      license: { id: 'lic-a', license_key: AGENT_LICENSE, tenant_id: TENANT_A, status: 'active', expires_at: '2099-01-01' },
    });
    // handler 内：cs_wechat_id 属 req.tenantId 校验（service_agents 反查 → TENANT_A，同租户）。
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
      .set('X-License-Key', AGENT_LICENSE) // 注意：不带 X-Internal-Token
      .send({ cs_wechat_id: CS, contacts: [{ name: '甲', last_message: '在吗' }] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, ingested: 1 });
    // 写库真发生了（事务跑了）
    expect(mockConnect).toHaveBeenCalled();
  });

  it('生产 token 已设 + 无 license + 无 token → 401（证明确实是 license 救了 agent）', async () => {
    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .send({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('agent license 属 TENANT_A，但 cs_wechat_id 属 TENANT_B → 403 CROSS_TENANT（不写库）', async () => {
    mockValidateLicense.mockResolvedValue({
      ok: true,
      license: { id: 'lic-a', license_key: AGENT_LICENSE, tenant_id: TENANT_A, status: 'active', expires_at: '2099-01-01' },
    });
    // cs_wechat_id 反查属 TENANT_B（别家），与 license 的 TENANT_A 不符 → 拒。
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_B }], rowCount: 1 });

    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .set('X-License-Key', AGENT_LICENSE)
      .send({ cs_wechat_id: 'wx_other_tenant', contacts: [{ name: '乙' }] });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('CROSS_TENANT');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('吊销 license → 401（不写库）', async () => {
    mockValidateLicense.mockResolvedValue({ ok: false, code: 'REVOKED', message: 'license 已吊销' });
    const res = await request(app)
      .post('/api/crm/friend-scan/ingest')
      .set('X-License-Key', 'ZJ-B-DEADBEEF')
      .send({ cs_wechat_id: CS, contacts: [{ name: '甲' }] });
    expect(res.status).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
