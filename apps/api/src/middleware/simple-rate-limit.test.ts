// apps/api/src/middleware/simple-rate-limit.test.ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { simpleRateLimit, tenantKeyFn } from './simple-rate-limit';

function buildApp(max: number, windowMs: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // 模拟 tenantContext：从 header 注入 req.tenantId
    const t = req.headers['x-tenant-id'] as string | undefined;
    if (t) req.tenantId = t;
    next();
  });
  app.get('/ping', simpleRateLimit({ windowMs, max }), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('simpleRateLimit（基于 express-rate-limit）', () => {
  it('放行窗口内 max 次以内的请求', async () => {
    const app = buildApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/ping').set('x-tenant-id', 'tenant-allow');
      expect(res.status).toBe(200);
    }
  });

  it('超过 max 次后返回 429 RATE_LIMITED', async () => {
    const app = buildApp(2, 60_000);
    await request(app).get('/ping').set('x-tenant-id', 'tenant-block');
    await request(app).get('/ping').set('x-tenant-id', 'tenant-block');
    const res3 = await request(app).get('/ping').set('x-tenant-id', 'tenant-block');

    expect(res3.status).toBe(429);
    expect(res3.body.success).toBe(false);
    expect(res3.body.error.code).toBe('RATE_LIMITED');
  });

  it('不同 tenant_id 互不影响（按租户隔离，不是按 IP）', async () => {
    const app = buildApp(1, 60_000);
    const resA = await request(app).get('/ping').set('x-tenant-id', 'tenant-iso-a');
    const resB = await request(app).get('/ping').set('x-tenant-id', 'tenant-iso-b');

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
  });

  it('窗口过期后计数重置', async () => {
    const app = buildApp(1, 50);
    const res1 = await request(app).get('/ping').set('x-tenant-id', 'tenant-expire');
    expect(res1.status).toBe(200);

    await new Promise((r) => setTimeout(r, 80));

    const res2 = await request(app).get('/ping').set('x-tenant-id', 'tenant-expire');
    expect(res2.status).toBe(200);
  });
});

describe('tenantKeyFn', () => {
  it('优先取 req.tenantId', () => {
    const req = { tenantId: 'from-context', body: { tenant_id: 'from-body' } } as unknown as express.Request;
    expect(tenantKeyFn(req)).toBe('from-context');
  });

  it('req.tenantId 缺失时回退 body.tenant_id', () => {
    const req = { body: { tenant_id: 'from-body' } } as unknown as express.Request;
    expect(tenantKeyFn(req)).toBe('from-body');
  });

  it('都没有时回退 query.tenant_id，再没有则 anonymous', () => {
    const req1 = { body: {}, query: { tenant_id: 'from-query' } } as unknown as express.Request;
    expect(tenantKeyFn(req1)).toBe('from-query');

    const req2 = { body: {}, query: {} } as unknown as express.Request;
    expect(tenantKeyFn(req2)).toBe('anonymous');
  });
});
