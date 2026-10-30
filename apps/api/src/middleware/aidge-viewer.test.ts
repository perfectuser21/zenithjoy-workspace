import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAidgeViewerGuard, isAidgeViewerId } from './aidge-viewer';

function testApp(sessionId: string | null) {
  const app = express();
  app.use(createAidgeViewerGuard(async () => sessionId, { AIDGE_VIEWER_USER_IDS: 'viewer-1,viewer-2' }));
  app.all('*', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Aidge 试用账号边界', () => {
  it('按用户 ID 授权，不按可抢注的邮箱授权', () => {
    expect(isAidgeViewerId('viewer-1', { AIDGE_VIEWER_USER_IDS: 'viewer-1,viewer-2' })).toBe(true);
    expect(isAidgeViewerId('another', { AIDGE_VIEWER_USER_IDS: 'viewer-1,viewer-2' })).toBe(false);
  });
  it('试用账号仅能调用 Aidge 和登录接口', async () => {
    const app = testApp('viewer-1');
    expect((await request(app).get('/api/aidge/catalog').set('Cookie', 'better-auth.session_token=test')).status).toBe(200);
    expect((await request(app).post('/api/auth/sign-out').set('Cookie', 'better-auth.session_token=test')).status).toBe(200);
    expect((await request(app).get('/api/works').set('Cookie', 'better-auth.session_token=test')).status).toBe(403);
    expect((await request(app).post('/api/creative-canvas/execute').set('Cookie', 'better-auth.session_token=test')).status).toBe(403);
  });
  it('普通用户不受影响', async () => {
    expect((await request(testApp('normal-user')).get('/api/works')).status).toBe(200);
  });
});
