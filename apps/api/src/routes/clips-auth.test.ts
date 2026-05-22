import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../services/clips-auth.service', () => ({
  buildFeishuOAuthUrl: vi.fn(() => 'https://feishu.cn/mock-oauth'),
  exchangeFeishuCode: vi.fn().mockResolvedValue({ userToken: 'tok', refreshToken: 'ref', userId: 'u1', userName: 'Alice', expiresAt: new Date() }),
  parseFeishuState: vi.fn(),
}));
vi.mock('../services/clips.service', () => ({
  upsertFeishuBinding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

async function buildApp(sessionUser: unknown) {
  const { auth } = await import('../auth');
  vi.mocked(auth.api.getSession).mockResolvedValue(sessionUser as never);
  const { default: router } = await import('./clips-auth');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('GET /feishu', () => {
  it('未登录返回 401', async () => {
    const app = await buildApp(null);
    const res = await request(app).get('/feishu');
    expect(res.status).toBe(401);
  });

  it('已登录重定向到飞书 OAuth', async () => {
    const app = await buildApp({ user: { id: 'user1' } });
    const res = await request(app).get('/feishu');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('feishu.cn');
  });
});

describe('GET /feishu/callback', () => {
  it('缺少 code 参数时重定向到错误页', async () => {
    const app = await buildApp(null);
    const res = await request(app).get('/feishu/callback?state=abc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=invalid_callback');
  });

  it('state 无效时重定向到错误页', async () => {
    const { parseFeishuState } = await import('../services/clips-auth.service');
    vi.mocked(parseFeishuState).mockReturnValue(null);
    const app = await buildApp(null);
    const res = await request(app).get('/feishu/callback?code=abc&state=invalid');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=invalid_state');
  });

  it('state 有效完成绑定重定向', async () => {
    const { parseFeishuState } = await import('../services/clips-auth.service');
    vi.mocked(parseFeishuState).mockReturnValue({ userId: 'user1', timestamp: Date.now() });
    const app = await buildApp(null);
    const res = await request(app).get('/feishu/callback?code=validcode&state=validstate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('feishu=bound');
  });
});
