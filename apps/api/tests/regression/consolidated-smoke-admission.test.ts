import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const deps = vi.hoisted(() => ({ query: vi.fn(), session: vi.fn() }));
vi.mock('../../src/db/connection', () => ({ default: { query: deps.query, end: vi.fn() } }));
vi.mock('../../src/auth', () => ({ auth: { api: { getSession: deps.session } } }));
// Import the actual application and its actual admission middleware. Only storage
// and the identity provider are fixtures; no live account, model or Agent is used.
import app from '../../src/app';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'isolated-contract-token');
  vi.stubEnv('ADMIN_FEISHU_OPENIDS', 'isolated-admin');
  vi.stubEnv('ADMIN_EMAILS', 'isolated@example.test');
  deps.session.mockResolvedValue(null);
  deps.query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('external network forbidden in admission fixture'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('actual app admission formerly repeated by HTTP smoke wrappers', () => {
  it.each([
    ['get', '/api/clips/settings', 401],
    ['get', '/api/clips/auth/feishu', 401],
    ['post', '/api/clips', 401],
    ['post', '/api/acquisition/account-scan/trigger', 401],
    ['get', '/api/acquisition/leads', 401],
    ['get', '/api/acquisition/signal-verify', 401],
    ['get', '/api/acquisition/agent/task-stream', 401],
    ['post', '/api/agent/burner/uia-signal', 401],
    ['get', '/api/admin/customers', 401],
    ['get', '/api/admin/customers/platform-sessions', 401],
    ['get', '/api/admin/customers/publish-logs', 401],
    ['post', '/api/operator/sessions/trigger-bind', 401],
    ['post', '/api/operator/sessions/sync', 401],
    ['get', '/api/feishu/oauth/status', 401],
    ['post', '/api/staff/skill-eval/upload', 403],
    ['get', '/api/staff/skill-eval/status/test-job-id', 403],
  ] as const)('%s %s refuses anonymous requests with %s', async (method, path, status) => {
    const response = await request(app)[method](path).send({});
    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(deps.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['get', '/api/lead-config/self'],
    ['post', '/api/feishu/customer-list/sync'],
    ['post', '/api/cs/voice-outreach/call'],
    ['get', '/api/cs/voice-outreach/records'],
  ] as const)('%s %s remains exactly 404', async (method, path) => {
    expect((await request(app)[method](path).send({})).status).toBe(404);
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('health exposes the actual application status', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('a legacy x-super-admin header cannot authorize operator sync', async () => {
    expect((await request(app).post('/api/operator/sessions/sync').set('x-super-admin', 'true')).status).toBe(401);
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('removed feishu seed is 404 after the shared smoke namespace guard', async () => {
    vi.stubEnv('SMOKE_TOKEN', 'isolated-smoke-token');
    const response = await request(app).post('/api/_smoke/feishu-seed')
      .set('X-Smoke-Token', 'isolated-smoke-token').send({});
    expect(response.status).toBe(404);
    expect(deps.query).not.toHaveBeenCalled();
  });

  it.each(['/api/admin/customers', '/api/operator/sessions/trigger-bind'])('non-admin identity is forbidden at %s', async path => {
    const response = path.includes('trigger-bind')
      ? await request(app).post(path).set('x-feishu-user-id', 'isolated-non-admin').send({ platform: 'douyin' })
      : await request(app).get(path).set('x-feishu-user-id', 'isolated-non-admin');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(deps.query).not.toHaveBeenCalled();
  });

  it.each(['douyin', 'kuaishou', 'xiaohongshu', 'shipinhao', 'toutiao', 'weibo', 'zhihu', 'gongzhonghao'])('authorized %s binding persists exactly the requested task', async platform => {
    const agent = 'aaaaaaaa-1111-2222-3333-444444444444';
    deps.query.mockResolvedValueOnce({ rows: [{ id: 'isolated-task-id' }] });
    const response = await request(app).post('/api/operator/sessions/trigger-bind')
      .set('x-feishu-user-id', 'isolated-admin').send({ platform, agent_id: agent });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ ok: true, platform, taskId: 'isolated-task-id' });
    expect(deps.query).toHaveBeenCalledTimes(1);
    expect(deps.query.mock.calls[0][0]).toMatch(/INSERT INTO zenithjoy\.publish_tasks/);
    expect(deps.query.mock.calls[0][1]).toEqual([agent, `qr_bind/${platform}`]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['platform-sessions', 'publish-logs'])('authorized customers %s binds the tenant filter into both queries', async endpoint => {
    const tenant = 'bbbbbbbb-1111-2222-3333-444444444444';
    deps.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [{ tenant_id: tenant }] });
    const response = await request(app).get(`/api/admin/customers/${endpoint}?tenant_id=${tenant}`)
      .set('x-feishu-user-id', 'isolated-admin');
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['data', 'success', 'total']);
    expect(response.body.total).toBe(1);
    expect(response.body.data).toHaveLength(1);
    for (const [sql, values] of deps.query.mock.calls) {
      expect(sql).toMatch(/WHERE [aw]\.tenant_id = \$1/);
      expect(values[0]).toBe(tenant);
    }
  });
});
