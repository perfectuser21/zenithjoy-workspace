/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 排程执行器面守卫（task 3abb7f8c）—— 工作机领单器调的那两个端点
 *
 * 要害三件：
 *   · 认领必须是原子 UPDATE（谓词带 status='queued'）。先 SELECT 再 UPDATE 会让两台
 *     机器领走同一单，同一个人被私信两次。
 *   · 只认一次性单（source='oneoff'）。周期活仍归 crontab，两套调度盯同一批活会跑两遍。
 *   · 回执只认"还在执行中"的那条；迟到的回执（活已被重排/取消）不许覆盖当前状态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const brainQuery = vi.fn();
let brainAvailable = true;

vi.mock('../../middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: any, _res: any, next: any) => next(),
  ipKeyFn: () => 'ip',
}));
// internalAuth 是中间件本身（不是工厂），照原样替身
vi.mock('../../middleware/internal-auth', () => ({
  internalAuth: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== 'Bearer tok-test') return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    next();
  },
}));
vi.mock('../../db/brain-pool', () => ({
  getBrainPool: () => (brainAvailable ? { query: (...a: any[]) => brainQuery(...a) } : null),
  BRAIN_CONNECT_TIMEOUT_MS: 8000,
}));

import { scheduleExecutorRouter } from '../schedule-executor';

const app = (() => {
  const a = express();
  a.use(express.json());
  a.use('/api/schedule', scheduleExecutorRouter);
  return a;
})();
const AUTH = { Authorization: 'Bearer tok-test' };

beforeEach(() => {
  vi.clearAllMocks();
  brainAvailable = true;
  brainQuery.mockResolvedValue({ rows: [] });
});

describe('鉴权', () => {
  it('没有内部 token 一律 401', async () => {
    const r = await request(app).post('/api/schedule/claim').send({ serials: ['S1'], claimer: 'm4' });
    expect(r.status).toBe(401);
  });
});

describe('认领', () => {
  it('缺序列号被拒', async () => {
    const r = await request(app).post('/api/schedule/claim').set(AUTH).send({ claimer: 'm4' });
    expect(r.status).toBe(400);
  });

  it('没活时返回 job=null（领单器据此安静退出）', async () => {
    const r = await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    expect(r.status).toBe(200);
    expect(r.body.data.job).toBeNull();
  });

  it('认领是原子 UPDATE：谓词带 status=queued，不是先查后改', async () => {
    await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    const [sql] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+tasks/i);
    expect(sql).toMatch(/status\s*=\s*'queued'/i);
    expect(sql).toMatch(/SKIP LOCKED/i);
  });

  it('只领一次性单 —— 周期活归 crontab，两套调度盯同一批会跑两遍', async () => {
    await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    const [sql] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/payload->>'source'\s*=\s*'oneoff'/i);
  });

  it('只领到点的活（due_at <= now），不提前动手', async () => {
    await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    const [sql] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/due_at\s*<=\s*NOW\(\)/i);
  });

  it('一次只领一条 —— 手机是独占资源，领多了只会排队等自己', async () => {
    await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    const [sql] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/LIMIT 1/i);
  });

  it('领到后把执行需要的字段交给领单器', async () => {
    brainQuery.mockResolvedValueOnce({
      rows: [{ id: 'j1', title: '触达一单', dept: '智能获客', row_version: 1, payload: { serial: 'S1', params: { action: 'open-search' } } }],
    });
    const r = await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    expect(r.body.data.job).toMatchObject({ id: 'j1', serial: 'S1', params: { action: 'open-search' } });
  });

  it('Brain 不可用时 503，领单器不会以为"没活"', async () => {
    brainAvailable = false;
    const r = await request(app).post('/api/schedule/claim').set(AUTH).send({ serials: ['S1'], claimer: 'm4' });
    expect(r.status).toBe(503);
  });
});

describe('回执', () => {
  it('缺 ok 被拒', async () => {
    const r = await request(app).post('/api/schedule/jobs/j1/finish').set(AUTH).send({});
    expect(r.status).toBe(400);
  });

  it('成功回执写 completed 并记 executed_at', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'completed' }] });
    const r = await request(app).post('/api/schedule/jobs/j1/finish').set(AUTH).send({ ok: true });
    expect(r.status).toBe(200);
    const [sql, params] = brainQuery.mock.calls[0];
    expect(params[1]).toBe('completed');
    expect(sql).toMatch(/executed_at/);
  });

  it('失败回执写 failed 并留下 error_code', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'failed' }] });
    await request(app).post('/api/schedule/jobs/j1/finish').set(AUTH).send({ ok: false, error_code: 'EXEC_RC_3' });
    const [, params] = brainQuery.mock.calls[0];
    expect(params[1]).toBe('failed');
    expect(params[2]).toBe('EXEC_RC_3');
  });

  it('只认还在执行中的那条：迟到的回执拿到 409，不覆盖当前状态', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [] });
    const r = await request(app).post('/api/schedule/jobs/j1/finish').set(AUTH).send({ ok: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('NOT_RUNNING');
  });

  it('回执用 jsonb_build_object 塞固定子键，不打散别人的 payload（jsonb || 是浅合并）', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'completed' }] });
    await request(app).post('/api/schedule/jobs/j1/finish').set(AUTH).send({ ok: true });
    const [sql] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/jsonb_build_object/);
    expect(sql).toMatch(/'receipt'/);
  });
});
