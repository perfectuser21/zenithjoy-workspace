import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import app from '../../app';
import pool from '../../db/connection';
import { auth } from '../../auth';

const mockQuery = pool.query as unknown as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;

const USER = { id: 'uid-001', email: 'test@zenithjoy.test', name: 'Tester' };
const PROFILE_ROW = { industry: '电商', audience: '18-35岁', style: '活泼' };

describe('GET /api/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未登录 → 401', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('已登录但无画像 → 404', async () => {
    mockGetSession.mockResolvedValueOnce({ user: USER });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(404);
  });

  it('已登录且有画像 → 200 + 三字段', async () => {
    mockGetSession.mockResolvedValueOnce({ user: USER });
    mockQuery.mockResolvedValueOnce({ rows: [PROFILE_ROW] });
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(PROFILE_ROW);
  });
});

describe('POST /api/profile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('未登录 → 401', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/profile').send(PROFILE_ROW);
    expect(res.status).toBe(401);
  });

  it('缺字段 → 400', async () => {
    mockGetSession.mockResolvedValueOnce({ user: USER });
    const res = await request(app).post('/api/profile').send({ industry: '电商' });
    expect(res.status).toBe(400);
  });

  it('三字段 UPSERT → 201 + 写回', async () => {
    mockGetSession.mockResolvedValueOnce({ user: USER });
    mockQuery.mockResolvedValueOnce({ rows: [PROFILE_ROW] });
    const res = await request(app).post('/api/profile').send(PROFILE_ROW);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(PROFILE_ROW);
  });
});
