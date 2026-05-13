/**
 * P4 WS1 — wechat routes: qr-bind / draft-review-poll / scheduler-tick.
 *
 * commit-1 RED (路由未挂); commit-2 GREEN.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../src/app';

describe('P4 WS1 — wechat 3 endpoints [BEHAVIOR]', () => {
  it('POST /api/wechat/qr-bind {} → 400 含 platform + agent_id zod 错', async () => {
    const res = await request(app).post('/api/wechat/qr-bind').send({});
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/platform/);
    expect(body).toMatch(/agent_id/);
  });

  it('GET /api/wechat/draft-review-poll?task_id=<bogus uuid> → 404', async () => {
    const res = await request(app).get('/api/wechat/draft-review-poll?task_id=00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('POST /api/wechat/scheduler-tick reachable (不是 404)', async () => {
    const res = await request(app).post('/api/wechat/scheduler-tick').send({});
    expect([200, 400, 401, 403]).toContain(res.status);
  });
});
