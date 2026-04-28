import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app';

vi.mock('../src/services/task-db', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'task-1', tenantId: 'tid', skill: 'wechat_draft', params: {},
    status: 'pending', agentId: null, agentText: null,
    result: null, error: null, createdAt: new Date(), startedAt: null, finishedAt: null,
  }),
  getTask: vi.fn().mockResolvedValue(null),
  listTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/services/task-dispatch', () => ({
  dispatchTask: vi.fn().mockResolvedValue(undefined),
  handleTaskResult: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/agent/tasks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 without tenantId', async () => {
    const res = await request(app).post('/api/agent/tasks').send({ skill: 'wechat_draft' });
    expect(res.status).toBe(400);
  });

  it('returns 400 without skill', async () => {
    const res = await request(app).post('/api/agent/tasks').send({ tenantId: 'tid' });
    expect(res.status).toBe(400);
  });

  it('returns 201 with task when valid', async () => {
    const res = await request(app)
      .post('/api/agent/tasks')
      .send({ tenantId: 'tid', skill: 'wechat_draft', params: { title: 'hello' } });
    expect(res.status).toBe(201);
    expect(res.body.task.id).toBe('task-1');
  });
});

describe('GET /api/agent/tasks', () => {
  it('returns 400 without tenantId', async () => {
    const res = await request(app).get('/api/agent/tasks');
    expect(res.status).toBe(400);
  });

  it('returns tasks list', async () => {
    const res = await request(app).get('/api/agent/tasks?tenantId=tid');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
  });
});

describe('GET /api/agent/tasks/:id', () => {
  it('returns 404 when task not found', async () => {
    const res = await request(app).get('/api/agent/tasks/no-such-id');
    expect(res.status).toBe(404);
  });
});
