/** Real helper HTTP/auth boundary; only PostgreSQL is isolated. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query } }));
import router from './_smoke-fake-agent-burner';
const app = express(); app.use(express.json()); app.use('/api/_smoke', router);
beforeEach(() => { vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('SMOKE_TOKEN', 'fixture-token'); query.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const send = () => request(app).post('/api/_smoke/fake-agent-burner-progress');
describe('dev helper actual HTTP gates and task update', () => {
  it('production rejects even with the correct smoke token and never writes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await send().set('X-Smoke-Token', 'fixture-token').send({ task_id: 'task', phase: 'done' })).status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
  it.each([undefined, 'wrong-token'])('missing/incorrect smoke token rejects before DB: %s', async (token) => {
    const req = send(); if (token) req.set('X-Smoke-Token', token);
    expect((await req.send({ task_id: 'task', phase: 'done' })).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
  it('missing required fields rejects without updating', async () => {
    expect((await send().set('X-Smoke-Token', 'fixture-token').send({ task_id: 'task' })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('successful update uses the exact task and reports success; unknown task is 404', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'task-1' }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const payload = { task_id: 'task-1', phase: 'chrome_launched', user_data_dir: '/fixture', current_url: 'https://example.test/login' };
    const recorded = await send().set('X-Smoke-Token', 'fixture-token').send(payload);
    expect(recorded.status).toBe(200);
    expect(recorded.body.success).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(['task-1', 'chrome_launched', '/fixture', 'https://example.test/login']);
    expect((await send().set('X-Smoke-Token', 'fixture-token').send({ ...payload, task_id: 'absent' })).status).toBe(404);
  });
});
