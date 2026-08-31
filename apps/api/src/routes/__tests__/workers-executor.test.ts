/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../services/worker-tasks-service', async () => {
  const actual = await vi.importActual<any>('../../services/worker-tasks-service');
  return { ...actual, startTask: vi.fn(), reportStep: vi.fn(), completeTask: vi.fn() };
});
vi.mock('../../services/worker-live', () => {
  const pushFrame = vi.fn(() => ({ seq: 1, at: Date.now(), bytes: Buffer.alloc(0) }));
  return { workerLive: { pushFrame } };
});
vi.mock('../../services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
import { startTask, reportStep, completeTask, WorkerTaskError } from '../../services/worker-tasks-service';
import { workerLive } from '../../services/worker-live';
import { validateLicense } from '../../services/walking-skeleton.service';
import pool from '../../db/connection';
import { workersExecutorRouter } from '../workers-executor';
function makeApp() { const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/api/workers', workersExecutorRouter); return app; }
const app = makeApp();
const TID = '11111111-1111-4111-8111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { vi.clearAllMocks(); delete process.env.ZENITHJOY_INTERNAL_TOKEN; });

describe('POST /api/workers/:agentId/tasks', () => {
  it('agentId 非 uuid → 400 INVALID_AGENT_ID，不调 service', async () => {
    const r = await request(app).post('/api/workers/not-a-uuid/tasks').send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(400); expect(r.body.error).toBe('INVALID_AGENT_ID'); expect(startTask).not.toHaveBeenCalled();
  });
  it('缺 title/steps/executor_id → 400', async () => {
    const r = await request(app).post(`/api/workers/${AID}/tasks`).send({ title: 'x' });
    expect(r.status).toBe(400); expect(startTask).not.toHaveBeenCalled();
  });
  it('成功 → 201 + task_id', async () => {
    (startTask as any).mockResolvedValue({ task_id: 't1', lease_until: '2026-01-01T00:00:00Z' });
    const r = await request(app).post(`/api/workers/${AID}/tasks`).send({ title: '发布', steps: ['a', 'b'], executor_id: 'ex' });
    expect(r.status).toBe(201); expect(r.body.data.task_id).toBe('t1');
  });
  it('WORKER_BUSY → 409，message 不重复 code 前缀', async () => {
    (startTask as any).mockRejectedValue(new WorkerTaskError('WORKER_BUSY', 'busy', 409));
    const r = await request(app).post(`/api/workers/${AID}/tasks`).send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(409); expect(r.body.error).toBe('WORKER_BUSY'); expect(r.body.message).toBe('busy');
  });
  it('设置 ZENITHJOY_INTERNAL_TOKEN 后无 token → 401', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    const r = await request(app).post(`/api/workers/${AID}/tasks`).send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(401);
  });
});
// 客户机 agent 用自带 license 推帧/开任务，拿不到内部编排 token；鉴权二选一（任一过即放行）。
// 鉴权挂在 router.use 层对所有 POST 生效，故测 /:agentId/tasks 等效覆盖 /:agentId/frame。
describe('POST /api/workers/:agentId/* — agent license 鉴权（与内部 token 二选一）', () => {
  const LICENSE_KEY = 'ZJ-TESTORG-AAAA1111';
  const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const licenseOk = (tenantId: string) => ({
    ok: true as const,
    license: { id: 'lic-1', license_key: LICENSE_KEY, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
  });
  const postTask = () => request(app).post(`/api/workers/${AID}/tasks`).set('X-Agent-License', LICENSE_KEY)
    .send({ title: '发布', steps: ['a'], executor_id: 'ex' });

  it('license 与 agent 同租户 → 放行（201），不需要内部 token', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockResolvedValue({ rows: [{ tenant_id: TENANT_A }] });
    (startTask as any).mockResolvedValue({ task_id: 't1', lease_until: '2026-01-01T00:00:00Z' });
    const r = await postTask();
    expect(r.status).toBe(201); expect(r.body.data.task_id).toBe('t1');
  });

  it('既无内部 token 也无 agent license → 401，不调 service', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    const r = await request(app).post(`/api/workers/${AID}/tasks`).send({ title: '发布', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(401); expect(startTask).not.toHaveBeenCalled();
  });

  it('license 属租户 A、agent 属租户 B → 403 TENANT_MISMATCH，不调 service', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockResolvedValue({ rows: [{ tenant_id: TENANT_B }] });
    const r = await postTask();
    expect(r.status).toBe(403); expect(r.body.error.code).toBe('TENANT_MISMATCH'); expect(startTask).not.toHaveBeenCalled();
  });
});
describe('POST /api/workers/tasks/:id/steps', () => {
  it('task id 非 uuid → 400 INVALID_TASK_ID，不调 service', async () => {
    const r = await request(app).post('/api/workers/tasks/not-a-uuid/steps').send({ step_index: 0, status: 'done', executor_id: 'ex' });
    expect(r.status).toBe(400); expect(r.body.error).toBe('INVALID_TASK_ID'); expect(reportStep).not.toHaveBeenCalled();
  });
  it('failed 缺三件套 → 400 FAILURE_SCENE_REQUIRED', async () => {
    (reportStep as any).mockRejectedValue(new WorkerTaskError('FAILURE_SCENE_REQUIRED', 'x', 400));
    const r = await request(app).post(`/api/workers/tasks/${TID}/steps`).send({ step_index: 2, status: 'failed', executor_id: 'ex' });
    expect(r.status).toBe(400); expect(r.body.error).toBe('FAILURE_SCENE_REQUIRED');
  });
  it('任务已结束 → 409', async () => {
    (reportStep as any).mockRejectedValue(new WorkerTaskError('TASK_NOT_RUNNING', 'x', 409));
    const r = await request(app).post(`/api/workers/tasks/${TID}/steps`).send({ step_index: 0, status: 'done', executor_id: 'ex' });
    expect(r.status).toBe(409);
  });
  it('成功 → 200', async () => {
    (reportStep as any).mockResolvedValue({ ok: true, screenshot_ref: null });
    const r = await request(app).post(`/api/workers/tasks/${TID}/steps`).send({ step_index: 0, status: 'done', executor_id: 'ex' });
    expect(r.status).toBe(200);
  });
});
describe('POST /api/workers/tasks/:id/complete', () => {
  it('成功 → 200', async () => {
    (completeTask as any).mockResolvedValue({ ok: true });
    const r = await request(app).post(`/api/workers/tasks/${TID}/complete`).send({ outcome: 'completed', executor_id: 'ex' });
    expect(r.status).toBe(200);
  });
});
describe('POST /api/workers/:agentId/frame', () => {
  it('agentId 非 uuid → 400 INVALID_AGENT_ID，不进帧缓冲', async () => {
    const r = await request(app).post('/api/workers/not-a-uuid/frame').set('Content-Type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.status).toBe(400); expect(r.body.error).toBe('INVALID_AGENT_ID'); expect(workerLive.pushFrame).not.toHaveBeenCalled();
  });
  it('image/jpeg 原始字节 → 202 seq', async () => {
    const r = await request(app).post(`/api/workers/${AID}/frame`).set('Content-Type', 'image/jpeg').send(Buffer.from([0xff, 0xd8, 0xff]));
    expect(r.status).toBe(202); expect(workerLive.pushFrame).toHaveBeenCalledWith(AID, expect.any(Buffer));
  });
  it('非 jpeg → 415', async () => {
    const r = await request(app).post(`/api/workers/${AID}/frame`).set('Content-Type', 'text/plain').send('x');
    expect(r.status).toBe(415);
  });
  it('帧超过 120KB → 413 FRAME_TOO_LARGE（JSON）', async () => {
    const big = Buffer.alloc(130 * 1024, 0xff);
    const r = await request(app).post(`/api/workers/${AID}/frame`).set('Content-Type', 'image/jpeg').send(big);
    expect(r.status).toBe(413); expect(r.body.error).toBe('FRAME_TOO_LARGE');
  });
});
