import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock child_process so we don't actually spawn the script
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })),
  execFile: vi.fn(),
}));

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

vi.mock('../src/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

// Task 9：POST /start 挂了 tenantContext + createCreditCharger('competitor_research')，
// 这里只关心 job 生命周期（本文件的测试目的），所以把 consume mock 成"余额总是充足"，
// 真正的扣减行为断言见 tests/routes/competitor-research-credit.test.ts。
vi.mock('../src/services/credits.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/credits.service')>();
  return {
    ...actual,
    consume: vi.fn().mockResolvedValue({ balance: 90, total_recharged: 100, total_consumed: 10 }),
  };
});

import app from '../src/app';
import pool from '../src/db/connection';
import { auth } from '../src/auth';

const TENANT_ID = 'dddddddd-1111-2222-3333-444444444444';
const AUTH_HEADER = { 'X-Feishu-User-Id': 'ou_competitor_research_test' };

beforeEach(() => {
  const mockQuery = pool.query as ReturnType<typeof vi.fn>;
  const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
  mockGetSession.mockResolvedValue(null);
  // tenantContext 查 tenant_members：本文件每条用例都走已登录、已绑定 tenant 的路径
  mockQuery.mockResolvedValue({ rows: [{ tenant_id: TENANT_ID, role: 'owner' }] });
});

describe('POST /api/competitor-research/start', () => {
  it('返回 jobId', async () => {
    const res = await request(app)
      .post('/api/competitor-research/start')
      .set(AUTH_HEADER)
      .send({ topic: '一人公司', roundLimit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeDefined();
    expect(typeof res.body.jobId).toBe('string');
  });

  it('不传参数使用默认值也能正常返回', async () => {
    const res = await request(app)
      .post('/api/competitor-research/start')
      .set(AUTH_HEADER)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeDefined();
  });
});

describe('GET /api/competitor-research/status/:jobId', () => {
  it('不存在的 jobId 返回 404', async () => {
    const res = await request(app)
      .get('/api/competitor-research/status/nonexistent-id');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('刚创建的 job 返回 pending/running 状态', async () => {
    const startRes = await request(app)
      .post('/api/competitor-research/start')
      .set(AUTH_HEADER)
      .send({ topic: '测试', roundLimit: 1 });

    const jobId = startRes.body.jobId;
    const statusRes = await request(app)
      .get(`/api/competitor-research/status/${jobId}`);

    expect(statusRes.status).toBe(200);
    expect(['pending', 'running']).toContain(statusRes.body.status);
    expect(Array.isArray(statusRes.body.logs)).toBe(true);
  });
});

describe('GET /api/competitor-research/results/:jobId', () => {
  it('未完成的 job 返回 400', async () => {
    const startRes = await request(app)
      .post('/api/competitor-research/start')
      .set(AUTH_HEADER)
      .send({ topic: '测试', roundLimit: 1 });

    const res = await request(app)
      .get(`/api/competitor-research/results/${startRes.body.jobId}`);

    expect(res.status).toBe(400);
  });
});
