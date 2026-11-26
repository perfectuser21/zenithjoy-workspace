import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { getSession, query } = vi.hoisted(() => ({ getSession: vi.fn(), query: vi.fn() }));
vi.mock('../src/auth', () => ({
  AUTH_TRUSTED_ORIGINS: ['https://compat.example.test'],
  auth: { handler: vi.fn(), api: { getSession } },
}));
vi.mock('../src/db/connection', () => ({ default: { query } }));

import app from '../src/app';

const route = '/api/content-factory/topics';
const staffEmail = 'employee@example.test';
const host = 'staging.example.test';
const topicId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const topic = { id: topicId, title: 'staging acceptance draft', status: '待研究' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('STAFF_EMAILS', staffEmail);
  vi.stubEnv('STAFF_FEISHU_OPENIDS', '');
  vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN', 'test-worker-credential');
  getSession.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe('content factory browser topics', () => {
  it('requires a server session before reading the shared staff pool', async () => {
    expect((await request(app).get(route)).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not substitute the worker credential for a staff session', async () => {
    const res = await request(app).get(route).set('Authorization', 'Bearer test-worker-credential');
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([['customer@example.test', true], [staffEmail, false]])(
    'denies users without trusted staff identity (%s, verified=%s)',
    async (email, emailVerified) => {
      getSession.mockResolvedValue({ user: { id: 'regular-user', email, emailVerified } });
      expect((await request(app).get(route)).status).toBe(403);
      expect(query).not.toHaveBeenCalled();
    }
  );

  it('rejects cross-origin reads and missing-origin writes before accessing the database', async () => {
    getSession.mockResolvedValue({ user: { id: 'staff', email: staffEmail, emailVerified: true } });
    const read = await request(app).get(route).set('Host', host).set('Origin', 'https://other.example.test');
    const write = await request(app).post(route).set('Host', host).send({ title: topic.title });
    expect(read.status).toBe(403);
    expect(write.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts same-origin browser writes through a configured compatibility proxy that rewrites Host', async () => {
    getSession.mockResolvedValue({ user: { id: 'staff', email: staffEmail, emailVerified: true } });
    query.mockResolvedValueOnce({ rows: [topic] });
    const post = (origin: string, site: string) => request(app).post(route).set({
      Host: host, Origin: origin, 'Sec-Fetch-Site': site,
    }).send({ title: topic.title });

    expect((await post('https://compat.example.test', 'same-site')).status).toBe(403);
    expect((await post('https://another.example.test', 'same-origin')).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect((await post('https://compat.example.test', 'same-origin')).status).toBe(201);
  });

  it('lets verified staff create, read back and remove their staging fixture through the existing topic handlers', async () => {
    getSession.mockResolvedValue({ user: { id: 'staff', email: staffEmail, emailVerified: true } });
    query.mockResolvedValueOnce({ rows: [topic] }).mockResolvedValueOnce({ rows: [topic] })
      .mockResolvedValueOnce({ rows: [topic], rowCount: 1 });
    const setOrigin = { Host: host, Origin: 'https://' + host };
    const created = await request(app).post(route).set(setOrigin).send({ title: topic.title });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual(topic);
    const read = await request(app).get(`${route}/${topic.id}`);
    expect(read.body.data).toEqual(topic);
    const removed = await request(app).delete(`${route}/${topic.id}`).set(setOrigin);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ id: topic.id, deleted: true, hard: false });
  });

  it('uses existing pacing config for staff with a verified directory user ID', async () => {
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'trusted-staff-id');
    getSession.mockResolvedValue({ user: { id: 'trusted-staff-id', email: '', emailVerified: false } });
    query.mockResolvedValueOnce({ rows: [{ key: 'daily_limit', value: '3' }] });
    expect((await request(app).get(`${route}/pacing/config`)).body.data).toEqual({ daily_limit: 3 });
  });

  it('keeps the worker route on its existing independent token contract', async () => {
    getSession.mockResolvedValue({ user: { id: 'staff', email: staffEmail, emailVerified: true } });
    expect((await request(app).get('/api/topics')).status).toBe(401);
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] }).mockResolvedValueOnce({ rows: [] });
    const worker = await request(app).get('/api/topics').set('Authorization', 'Bearer test-worker-credential');
    expect(worker.status).toBe(200);
    expect(worker.body.data.items).toEqual([]);
  });
});
