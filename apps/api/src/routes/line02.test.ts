import { describe, it, expect } from 'vitest';
import { line02Router } from './line02';
import express from 'express';
import request from 'supertest';

// 轻量级路由存在性检查 — 详细行为测试在 sprints/06282255-line02-company-profile-collect/tests/
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/line02', line02Router);
  return app;
}

describe('line02 router', () => {
  it('GET /api/line02/account-status returns 200 with accounts array', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/line02/account-status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.accounts)).toBe(true);
  });

  it('GET /api/line02/account-status data only has accounts key', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/line02/account-status');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data)).toEqual(['accounts']);
  });
});
