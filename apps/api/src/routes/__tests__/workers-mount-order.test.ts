/* eslint-disable @typescript-eslint/no-explicit-any */
// 执行器面（internalAuth）与读面（租户）串联挂载时，GET 不该被执行器面的
// internalAuth 拦下——internalAuth 只应对 POST 生效，其它方法必须落到读面。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../services/worker-tasks-service', () => ({
  startTask: vi.fn(), reportStep: vi.fn(), completeTask: vi.fn(),
  listWorkers: vi.fn(), getActivity: vi.fn(async () => null), agentBelongsToTenant: vi.fn(),
}));
vi.mock('../../services/worker-live', () => ({
  workerLive: { pushFrame: vi.fn(), latest: vi.fn(() => null), subscribe: vi.fn(() => () => {}) },
}));
vi.mock('../../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => { req.tenantId = req.headers['x-tenant-id'] || ''; next(); },
}));
import { workersExecutorRouter } from '../workers-executor';
import { workersReadRouter } from '../workers-read';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workers', workersExecutorRouter);
  app.use('/api/workers', workersReadRouter);
  return app;
}
const app = makeApp();

describe('workers 执行器面 + 读面串联挂载', () => {
  const prevToken = process.env.ZENITHJOY_INTERNAL_TOKEN;
  beforeEach(() => { vi.clearAllMocks(); process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret'; });
  afterEach(() => { if (prevToken === undefined) delete process.env.ZENITHJOY_INTERNAL_TOKEN; else process.env.ZENITHJOY_INTERNAL_TOKEN = prevToken; });

  it('设置 ZENITHJOY_INTERNAL_TOKEN 后，无 token 的 GET 不被执行器面 401 拦下（应到达读面）', async () => {
    const r = await request(app).get('/api/workers/a1/activity').set('X-Tenant-Id', 'tenant-a');
    // 到达读面：getActivity mock 返回 null → 404（不是执行器面的 401 UNAUTHORIZED）
    expect(r.status).toBe(404);
    expect(r.body.error).not.toBe('UNAUTHORIZED');
  });

  it('设置 ZENITHJOY_INTERNAL_TOKEN 后，无 token 的 POST 仍被执行器面 401 拦下', async () => {
    const r = await request(app).post('/api/workers/a1/tasks').send({ title: 't', steps: ['a'], executor_id: 'ex' });
    expect(r.status).toBe(401);
  });
});
