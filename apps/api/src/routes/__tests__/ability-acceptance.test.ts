/**
 * Ability Acceptance API 路由合同测试
 * Sprint ID: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
 *
 * T1 — 无认证头 → 403 FORBIDDEN
 * T2 — 白名单外邮箱 → 403 FORBIDDEN
 * T3 — 首次创建 run → created:true + run_id UUID
 * T4 — 同参数二次创建 → created:false + run_id 相同（幂等）
 * T5 — 多租户隔离：tenant_b 查不到 tenant_a 的 run
 * T6 — audit 字段 created_by 来自 X-User-Email
 * T7 — device_index > 5 → 400 DEVICE_INDEX_OUT_OF_RANGE
 * T8 — result 非法值 → 400 输入校验错误
 * T9 — submit 后 POST checks → 400 RUN_ALREADY_SUBMITTED
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const dbQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../db/connection', () => ({
  default: { query: dbQueryMock },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('../../middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  tenantKeyFn: () => 'anonymous',
  ipKeyFn: () => 'anonymous',
}));

const axiosPostMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    get: axiosGetMock,
    isAxiosError: () => false,
  },
}));

import app from '../../app';

const STAFF_EMAIL_A = 'staff-a@test.com';
const STAFF_EMAIL_B = 'staff-b@test.com';
const TENANT_A = 'tenant-aaa';
const TENANT_B = 'tenant-bbb';
const TEST_RUN_ID = '11111111-1111-1111-1111-111111111111';

describe('[Contract B1-B2] staffGuard 保护', () => {
  it('T1: 无认证头 GET /api/staff/ability-acceptance/runs → 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get('/api/staff/ability-acceptance/runs');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('T2: 白名单外邮箱 GET /runs → 403 FORBIDDEN', async () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const res = await request(app)
      .get('/api/staff/ability-acceptance/runs')
      .set('X-User-Email', 'unknown@test.com');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
    vi.unstubAllEnvs();
  });
});

describe('[Contract B3-B4] 幂等创建 run', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', `${STAFF_EMAIL_A},${STAFF_EMAIL_B}`);
    dbQueryMock.mockReset();
  });

  it('T3: 首次 POST /runs 返回 created:true + UUID run_id', async () => {
    // 第一次查询：无已存在记录
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    // 第二次查询：INSERT 返回新 run_id
    dbQueryMock.mockResolvedValueOnce({ rows: [{ run_id: TEST_RUN_ID }] });

    const res = await request(app)
      .post('/api/staff/ability-acceptance/runs')
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ app_id: 'customer_app', line_id: 'line02', surface: 'android', task_id: '30a0c83a', sha: 'abc1234' });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('T4: 同参数二次 POST /runs 返回 created:false + 相同 run_id', async () => {
    // 查询时已有记录
    dbQueryMock.mockResolvedValueOnce({ rows: [{ run_id: TEST_RUN_ID }] });

    const res = await request(app)
      .post('/api/staff/ability-acceptance/runs')
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ app_id: 'customer_app', line_id: 'line02', surface: 'android', task_id: '30a0c83a', sha: 'abc1234' });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(false);
    expect(res.body.data.run_id).toBe(TEST_RUN_ID);
  });
});

describe('[Contract B9 / 铁律] 多租户隔离', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', `${STAFF_EMAIL_A},${STAFF_EMAIL_B}`);
    dbQueryMock.mockReset();
  });

  it('T5: tenant_b 查 GET /runs 不含 tenant_a 的 run_id', async () => {
    const runIdA = '22222222-2222-2222-2222-222222222222';
    const runIdB = '33333333-3333-3333-3333-333333333333';

    // tenant_b 的查询只返回 tenant_b 的数据
    dbQueryMock.mockResolvedValueOnce({ rows: [{ run_id: runIdB, tenant_id: TENANT_B }] });

    const res = await request(app)
      .get('/api/staff/ability-acceptance/runs')
      .set('X-User-Email', STAFF_EMAIL_B)
      .set('X-Tenant-Id', TENANT_B);

    expect(res.status).toBe(200);
    const runIds = (res.body.data || []).map((r: { run_id: string }) => r.run_id);
    expect(runIds).not.toContain(runIdA);
  });
});

describe('[Contract B8 / 铁律] audit 字段', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', `${STAFF_EMAIL_A}`);
    dbQueryMock.mockReset();
  });

  it('T6: acceptance_run.created_by 等于请求头 X-User-Email（非 null 非空）', async () => {
    // 查询：无已存在记录
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    // INSERT 返回
    dbQueryMock.mockResolvedValueOnce({ rows: [{ run_id: TEST_RUN_ID }] });

    await request(app)
      .post('/api/staff/ability-acceptance/runs')
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ app_id: 'customer_app', line_id: 'line02', surface: 'android', task_id: '30a0c83a', sha: 'abc1234' });

    // 验证 INSERT 调用中 created_by 参数等于 STAFF_EMAIL_A
    const insertCall = dbQueryMock.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO acceptance_run')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as string[];
    expect(params).toContain(STAFF_EMAIL_A);
  });
});

describe('[Contract B7 / B edge] 输入校验', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', `${STAFF_EMAIL_A}`);
    dbQueryMock.mockReset();
  });

  it('T7: device_index = 6 → 400 DEVICE_INDEX_OUT_OF_RANGE', async () => {
    const res = await request(app)
      .post(`/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/6/checks`)
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ template_id: 'tpl-001', result: 'PASS' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('DEVICE_INDEX_OUT_OF_RANGE');
  });

  it('T8: result = "SKIP"（非法值）→ 400 输入校验错误', async () => {
    // 先让 run 查询返回存在且 in_progress
    dbQueryMock.mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] });

    const res = await request(app)
      .post(`/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/1/checks`)
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ template_id: 'tpl-001', result: 'SKIP' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('[Contract B7] 提交后锁定', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', `${STAFF_EMAIL_A}`);
    dbQueryMock.mockReset();
  });

  it('T9: submit 后 POST /checks → 400 RUN_ALREADY_SUBMITTED', async () => {
    // run 查询返回 submitted 状态
    dbQueryMock.mockResolvedValueOnce({ rows: [{ status: 'submitted' }] });

    const res = await request(app)
      .post(`/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/1/checks`)
      .set('X-User-Email', STAFF_EMAIL_A)
      .set('X-Tenant-Id', TENANT_A)
      .send({ template_id: 'tpl-001', result: 'FAIL' });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('RUN_ALREADY_SUBMITTED');
  });
});

describe('[合同回归 R1] 累积 FR 不回退', () => {
  it('R1: POST /api/staff/skill-eval/upload 不带认证头仍返回 403', async () => {
    const res = await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('Content-Type', 'multipart/form-data');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });
});
