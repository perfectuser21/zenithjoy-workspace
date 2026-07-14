import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('已删除的飞书 Bitable 路由（决策19e6480c，2026-07-14）', () => {
  it('GET /api/lead-config/self → 404（路由已删除）', async () => {
    const res = await request(app).get('/api/lead-config/self');
    expect(res.status).toBe(404);
  });

  it('POST /api/feishu/customer-list/sync → 404（路由已删除）', async () => {
    const res = await request(app).post('/api/feishu/customer-list/sync').send({});
    expect(res.status).toBe(404);
  });

  it('POST /api/_smoke/feishu-seed → 404（路由已删除）', async () => {
    const res = await request(app).post('/api/_smoke/feishu-seed').send({});
    expect(res.status).toBe(404);
  });
});
