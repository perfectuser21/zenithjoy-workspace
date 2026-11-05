import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const calls = vi.hoisted(() => ({ history: 0, tenant: 0, agent: 0 }));
vi.mock('../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../middleware/acquisition-history-auth', () => ({
  acquisitionHistoryAuth: (_req: express.Request, res: express.Response) => { calls.history++; res.status(401).json({ error: 'SESSION_REQUIRED' }); },
}));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { calls.tenant++; req.tenantId = req.header('x-test-tenant'); next(); },
  tenantContextOptional: (req: express.Request, _res: express.Response, next: express.NextFunction) => { calls.tenant++; req.tenantId = req.header('x-test-tenant'); next(); },
}));
vi.mock('../middleware/agent-context', () => ({ agentContext: (_req: express.Request, _res: express.Response, next: express.NextFunction) => { calls.agent++; next(); } }));
import { acquisitionRouter } from './acquisition';
import { acquisitionDispatchRouter } from './acquisition-dispatch';
import { agentBurnerRouter } from './agent-burner';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter, acquisitionRouter);
app.use('/api/agent/burner', agentBurnerRouter);

const histories = [
  '/api/acquisition/collect-tasks', '/api/acquisition/collect-tasks/00000000-0000-0000-0000-000000000001/videos',
  '/api/acquisition/videos/video-a/leads', '/api/acquisition/leads', '/api/acquisition/outreach-history',
  '/api/acquisition/dispatch/outreach-history', '/api/agent/burner/warmup-liveness',
];
const retired = [
  '/api/acquisition/collect/start', '/api/acquisition/account-scan/trigger', '/api/acquisition/build-assignments',
  '/api/acquisition/dispatch/build', '/api/acquisition/dispatch/run', '/api/acquisition/warmup/run',
  '/api/agent/burner/qr-bind', '/api/agent/burner/crawl-comments', '/api/agent/burner/dm-outreach',
];

describe('acquisition traffic limits protect auth and database work', () => {
  it('limits historical cancellation before history authentication', async () => {
    const initial = calls.history;
    expect((await request(app).post('/api/acquisition/collect/cancel').send({})).status).toBe(401);
    let response = await request(app).post('/api/acquisition/collect/cancel').send({});
    for (let i = 2; i <= 30; i++) response = await request(app).post('/api/acquisition/collect/cancel').send({});
    expect(response.status).toBe(429);
    const after = calls.history;
    expect(after - initial).toBeLessThanOrEqual(30);
    expect((await request(app).post('/api/acquisition/collect/cancel').send({})).status).toBe(429);
    expect(calls.history).toBe(after);
  }, 30_000);
  for (const path of histories) it(`limits ${path} before history authentication`, async () => {
    const initial = calls.history;
    const first = await request(app).get(path);
    expect(first.status).toBe(401);
    let response = first;
    for (let i = 1; i <= 120; i++) response = await request(app).get(path);
    expect(response.status).toBe(429);
    const after = calls.history;
    expect(after - initial).toBe(120);
    expect((await request(app).get(path)).status).toBe(429);
    expect(calls.history).toBe(after);
  }, 30_000);
  for (const path of retired) it(`limits ${path} by IP before tenant or agent resolution`, async () => {
    const initial = calls.tenant;
    const first = await request(app).post(path).set('x-test-tenant', 'tenant-0').send({});
    expect(first.status).toBe(410);
    let response = first;
    for (let i = 1; i <= 120; i++) response = await request(app).post(path).set('x-test-tenant', `tenant-${i}`).send({});
    expect(response.status).toBe(429);
    const after = calls.tenant;
    expect(after - initial).toBeLessThanOrEqual(120);
    expect((await request(app).post(path).set('x-test-tenant', 'tenant-last').send({})).status).toBe(429);
    expect(calls.tenant).toBe(after);
  }, 30_000);
  it('retired/history budgets do not rate-limit shared sessions or device callbacks', async () => {
    const sessions = await request(app).get('/api/agent/burner/sessions');
    const callback = await request(app).post('/api/agent/burner/dm-outreach-result').send({});
    expect(sessions.status).not.toBe(429);
    expect(callback.status).not.toBe(429);
  });
});
