import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery },
}));

vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

async function buildApp(sessionUser: unknown) {
  const { auth } = await import('../auth');
  vi.mocked(auth.api.getSession).mockResolvedValue(sessionUser as never);
  const { agentInstallPackRouter } = await import('./agent-install-pack');
  const app = express();
  app.use(express.json());
  app.use('/api/agent/install-pack', agentInstallPackRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/install-pack/android', () => {
  it('无 session → 401 UNAUTHORIZED', async () => {
    const app = await buildApp(null);
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('有 session + active license → 200，apk_url 是 COS 直链，deeplink 带 license', async () => {
    const app = await buildApp({ user: { id: 'user-1' } });
    mockQuery.mockResolvedValueOnce({ rows: [{ license_key: 'ZJ-F-A1B2C3D4' }] });
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.apk_url).toMatch(/^https:\/\/.*\.myqcloud\.com\/install-pack\/android\/zenithjoy-agent\.apk$/);
    expect(res.body.deeplink).toMatch(/^zenithjoy:\/\/bind\?/);
    expect(res.body.deeplink).toContain('license=ZJ-F-A1B2C3D4');
    expect(res.body.license_key).toBe('ZJ-F-A1B2C3D4');
  });

  it('有 session 无 license → 200，deeplink 不含 license 参数', async () => {
    const app = await buildApp({ user: { id: 'user-2' } });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/agent/install-pack/android');
    expect(res.status).toBe(200);
    expect(res.body.license_key).toBe('');
    expect(res.body.deeplink).not.toContain('license=');
    expect(res.body.deeplink).toContain('api=');
  });
});
