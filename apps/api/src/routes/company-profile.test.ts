import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

vi.mock('../middleware/tenant-context', () => ({
  tenantContextOptional: (req: Request, _res: Response, next: NextFunction) => {
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
  it('GET /api/company-profile returns 200 with success field', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/company-profile');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PUT /api/company-profile without company_name returns 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .put('/api/company-profile')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
  });
});
