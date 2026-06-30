/**
 * P4 — wechat routes: qr-bind / scheduler-tick（去飞书后 draft-review-poll 已删）。
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';

describe('P4 — wechat endpoints [BEHAVIOR]', () => {
  it('POST /api/wechat/qr-bind {} → 400 含 platform + agent_id zod 错', async () => {
    const res = await request(app).post('/api/wechat/qr-bind').send({});
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/platform/);
    expect(body).toMatch(/agent_id/);
  });

  it('POST /api/wechat/scheduler-tick reachable (不是 404)', async () => {
    const res = await request(app).post('/api/wechat/scheduler-tick').send({});
    expect([200, 400, 401, 403]).toContain(res.status);
  });
});
