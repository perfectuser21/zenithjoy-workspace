import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: Request, _res: Response, next: NextFunction) => {
    req.tenantId = undefined;
    next();
  },
}));

import { companyProfileRouter } from './company-profile';

// 轻量级路由存在性检查 — 详细行为测试在 sprints/06282255-line02-company-profile-collect/tests/
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/company-profile', companyProfileRouter);
  return app;
}

describe('company-profile router', () => {
  it('GET /api/company-profile 缺租户返回403', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/company-profile');
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('PUT /api/company-profile 缺租户不允许保存', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/company-profile')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(403);
  });
});
