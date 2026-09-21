/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * /api/schedule 两个 router 串联挂载的顺序守卫（task 3abb7f8c）
 *
 * 生产事故：执行器面（internalAuth）挂在读写面之前，而它的鉴权是 router.use()，
 * 对**所有方法所有路径**生效 —— 主理人打开工作机页，GET /api/schedule 先撞上
 * 执行器面的 internalAuth，直接 401，页面整块显示「读取失败（HTTP 401）」。
 *
 * /api/workers 早就踩过同款坑并解决了（那边执行器面只对 POST 生效）。这里两边
 * 都有 POST（`POST /jobs` 是派单、`POST /jobs/:id/finish` 是回执），按方法区分不够，
 * 必须**按路径**让开：不属于执行器面的请求要原样落到后面的读写面。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const brainQuery = vi.fn();
const localQuery = vi.fn();

vi.mock('../../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    req.tenantId = req.headers['x-feishu-user-id'] || '';
    next();
  },
}));
vi.mock('../../middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: any, _res: any, next: any) => next(),
  tenantKeyFn: () => 't',
  ipKeyFn: () => 'ip',
}));
vi.mock('../../middleware/internal-auth', () => ({
  internalAuth: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== 'Bearer tok-test') {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: '内部 token 无效' });
    }
    next();
  },
}));
vi.mock('../../db/connection', () => ({ default: { query: (...a: any[]) => localQuery(...a) } }));
vi.mock('../../db/brain-pool', () => ({
  getBrainPool: () => ({ query: (...a: any[]) => brainQuery(...a) }),
  BRAIN_CONNECT_TIMEOUT_MS: 8000,
}));

import { scheduleRouter } from '../schedule';
import { scheduleExecutorRouter } from '../schedule-executor';

/** 与 app.ts 同序：执行器面先注册，读写面后注册 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/schedule', scheduleExecutorRouter);
  app.use('/api/schedule', scheduleRouter);
  return app;
}
const app = makeApp();
const TENANT = { 'x-feishu-user-id': 'tenant-1' };
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
  localQuery.mockResolvedValue({
    rows: [{ id: MINE, nickname: '金诺工作机', agent_id: 'SER1', status: 'online', last_seen: new Date() }],
  });
  brainQuery.mockResolvedValue({ rows: [] });
});

describe('读面不被执行器面的内部鉴权拦下（生产 401 事故的回归守卫）', () => {
  it('GET /api/schedule 带登录态必须落到读写面，而不是被 internalAuth 401', async () => {
    const r = await request(app).get('/api/schedule').set(TENANT);
    expect(r.status, '读面被执行器面的 internalAuth 拦了——页面会整块显示「读取失败 401」').toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('GET 没有登录态时是读写面给的 401（NO_TENANT），不是执行器面给的', async () => {
    const r = await request(app).get('/api/schedule');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('NO_TENANT');
  });
});

describe('派单走读写面，回执走执行器面（两个 POST 路径不能互相吃掉）', () => {
  it('POST /jobs（派单）由读写面处理：认租户，不认内部 token', async () => {
    const start = new Date(Date.now() + 30 * 60_000).toISOString();
    const end = new Date(Date.parse(start) + 60 * 60_000).toISOString();
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'n1', row_version: 0 }] });
    const r = await request(app).post('/api/schedule/jobs').set(TENANT)
      .send({ agent_id: MINE, dept: '智能获客', title: '触达一单', window_start: start, window_end: end });
    expect(r.status, '派单被执行器面吃掉了').toBe(201);
  });

  it('POST /jobs/:id/finish（回执）由执行器面处理：认内部 token', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'completed' }] });
    const r = await request(app).post('/api/schedule/jobs/j1/finish')
      .set({ Authorization: 'Bearer tok-test' }).send({ ok: true });
    expect(r.status).toBe(200);
  });

  it('POST /claim（认领）由执行器面处理，没有内部 token 时 401', async () => {
    const r = await request(app).post('/api/schedule/claim').send({ serials: ['S1'], claimer: 'm4' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('UNAUTHORIZED');
  });
});

describe('改时间/取消也不能被执行器面误吃', () => {
  it('PATCH /jobs/:id/time 落到读写面（按租户鉴权）', async () => {
    const r = await request(app).patch('/api/schedule/jobs/j1/time').set(TENANT)
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 0 });
    // 走到读写面才会去查归属；被执行器面拦下的话会是 UNAUTHORIZED
    expect(r.body.error).not.toBe('UNAUTHORIZED');
  });

  it('POST /jobs/:id/cancel 落到读写面', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', row_version: 1 }] });
    const r = await request(app).post('/api/schedule/jobs/j1/cancel').set(TENANT).send({});
    expect(r.body.error).not.toBe('UNAUTHORIZED');
  });
});
