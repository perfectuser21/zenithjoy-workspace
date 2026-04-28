import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// mock child_process so we don't actually spawn the script
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  })),
}));

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

import app from '../src/app';

describe('POST /api/competitor-research/start', () => {
  it('返回 jobId', async () => {
    const res = await request(app)
      .post('/api/competitor-research/start')
      .send({ topic: '一人公司', roundLimit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.jobId).toBeDefined();
    expect(typeof res.body.jobId).toBe('string');
  });

  it('不传参数使用默认值也能正常返回', async () => {
    const res = await request(app)
      .post('/api/competitor-research/start')
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
      .send({ topic: '测试', roundLimit: 1 });

    const res = await request(app)
      .get(`/api/competitor-research/results/${startRes.body.jobId}`);

    expect(res.status).toBe(400);
  });
});
