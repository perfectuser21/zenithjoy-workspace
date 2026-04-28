/**
 * app.ts 入口测试 — 仅冒烟（health + 关键路由挂载）
 *
 * 触发原因：v1.2 license PR 在 app.ts 加了 adminLicenseRouter 挂载，
 * lint-test-pairing 要求 src 文件配套测试。这里只做冒烟，业务测试在路由测试文件里。
 */

import request from 'supertest';
import { vi, describe, it, expect } from 'vitest';
import app from '../src/app';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

describe('app.ts entry', () => {
  it('GET /health 返回 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('未挂载路径返回 404', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('/api/admin/license 路由已挂载（不会 404）', async () => {
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    // 不带 body，期望被路由 handler 接管返回 400 INVALID_TIER（而不是 404）
    const res = await request(app).post('/api/admin/license').send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('INVALID_TIER');
  });

  it('/api/agent/register 路由已挂载', async () => {
    const res = await request(app).post('/api/agent/register').send({});
    // 缺 license_key → BAD_REQUEST 400（不是 404）
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
