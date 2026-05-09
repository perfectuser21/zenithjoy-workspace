/**
 * WS3 — GET /api/lead-config/:tenantId 路由 + POST /api/feishu/oauth/* 路由
 *
 * commit-1 RED（路由未挂）；commit-2 GREEN。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../../../../apps/api/src/db/connection', () => ({
  default: { query: mockQuery, end: vi.fn(), connect: vi.fn() },
}));

vi.mock('../../../../apps/api/src/services/feishu-token', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock_token_xxx'),
  getAuthorizeUrl: vi.fn().mockResolvedValue('https://passport.feishu.cn/suite/passport/oauth/authorize?state=signed_xxx'),
  handleCallback: vi.fn().mockResolvedValue({ tenant_id: 'tenant-xyz' }),
}));

vi.mock('../../../../apps/api/src/services/feishu-bitable-multitenant', () => ({
  provisionBitable: vi.fn().mockResolvedValue({
    app_token: 'a',
    table_id_lead_profile: 't1',
    table_id_target_videos: 't2',
    table_id_leads: 't3',
  }),
  fetchLeadConfig: vi.fn(async (tenantId: string) => {
    if (tenantId === 'not-bound') throw new Error('FEISHU_NOT_BOUND');
    return {
      profile: { industry: '装修', keyword: '小户型', hook: '送装修方案 PDF' },
      target_videos: [{ url: 'https://v.douyin.com/test/', note: 'smoke' }],
    };
  }),
}));

const importApp = async () => (await import('../../../../apps/api/src/app')).default;

describe('Workstream 3 — lead-config + feishu-oauth routes [BEHAVIOR]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('GET /api/lead-config/:tenantId 返回 200 + 正确结构', async () => {
    const app = await importApp();
    const res = await request(app).get('/api/lead-config/tenant-xyz').set('X-Tenant-Id', 'tenant-xyz');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.industry).toBe('装修');
    expect(res.body.data.profile.keyword).toBe('小户型');
    expect(res.body.data.target_videos).toHaveLength(1);
    expect(res.body.data.target_videos[0].url).toMatch(/^https:\/\//);
  });

  it('GET /api/lead-config/:tenantId 当未绑飞书返回 400 FEISHU_NOT_BOUND', async () => {
    const app = await importApp();
    const res = await request(app).get('/api/lead-config/not-bound').set('X-Tenant-Id', 'not-bound');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FEISHU_NOT_BOUND');
  });

  it('POST /api/feishu/oauth/start 缺 app_id 返回 400', async () => {
    const app = await importApp();
    const res = await request(app)
      .post('/api/feishu/oauth/start')
      .set('X-Tenant-Id', 'tenant-xyz')
      .send({ app_secret: 'only_secret' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/feishu/oauth/start 正常返回 authorize_url', async () => {
    const app = await importApp();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tenant-xyz' }] }); // tenant 存在
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE feishu_app_id
    const res = await request(app)
      .post('/api/feishu/oauth/start')
      .set('X-Tenant-Id', 'tenant-xyz')
      .send({ app_id: 'cli_xxx', app_secret: 'sec_xxx' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.authorize_url).toMatch(/feishu\.cn/);
  });

  it('GET /api/feishu/oauth/callback 缺 code 返回 400', async () => {
    const app = await importApp();
    const res = await request(app).get('/api/feishu/oauth/callback?state=xxx');
    expect(res.status).toBe(400);
  });
});
