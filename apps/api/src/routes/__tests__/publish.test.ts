import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));
vi.mock('../../controllers/publish.controller', () => ({
  PublishController: class {
    getPublishLogs = vi.fn((_req, res) => res.json({ success: true, data: [] }));
    createPublishLog = vi.fn((_req, res) => res.status(201).json({ success: true }));
    updatePublishLog = vi.fn((_req, res) => res.json({ success: true }));
  },
}));

async function buildApp() {
  const { default: router } = await import('../publish');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('publish-logs routes — feishu auth', () => {
  beforeEach(() => { vi.resetModules(); });

  it('GET /works/:id/publish-logs → 401 without X-Feishu-User-Id', async () => {
    const app = await buildApp();
    const res = await request(app).get('/works/test-id/publish-logs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST /works/:id/publish-logs → 401 without X-Feishu-User-Id', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/works/test-id/publish-logs')
      .send({ platform: 'douyin' });
    expect(res.status).toBe(401);
  });

  it('PUT /publish-logs/:id → 401 without X-Feishu-User-Id', async () => {
    const app = await buildApp();
    const res = await request(app).put('/publish-logs/log-1').send({});
    expect(res.status).toBe(401);
  });
});
