import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TEST_USER = 'ou_perf_test_001';
const TEST_TENANT_ID = 'tttttttt-1111-2222-3333-dddddddddddd';
const WORK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const SNAPSHOT_ROWS = [
  {
    platform: 'douyin',
    date: '2026-01-02',
    day_n: 1,
    views: 1000,
    likes: 50,
    comments: 10,
    shares: 5,
    saves: 3,
  },
  {
    platform: 'douyin',
    date: '2026-01-03',
    day_n: 2,
    views: 800,
    likes: 40,
    comments: 8,
    shares: 3,
    saves: 2,
  },
];

describe('Work Performance API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // tenantContext middleware
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }] });
  });

  describe('GET /api/works/:id/performance', () => {
    it('returns performance data grouped by platform under .platforms key', async () => {
      mockQuery.mockResolvedValueOnce({ rows: SNAPSHOT_ROWS });
      const res = await request(app)
        .get(`/api/works/${WORK_ID}/performance`)
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      // route returns { work_id, platforms: { <platform>: [...] } }
      expect(res.body.work_id).toBe(WORK_ID);
      expect(res.body.platforms).toHaveProperty('douyin');
      expect(Array.isArray(res.body.platforms.douyin)).toBe(true);
      expect(res.body.platforms.douyin[0]).toHaveProperty('views');
      expect(res.body.platforms.douyin[0]).toHaveProperty('day_n');
    });

    it('returns empty platforms when work has no publish logs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get(`/api/works/${WORK_ID}/performance`)
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.platforms).toEqual({});
    });

    it('returns multi-platform data when published on multiple platforms', async () => {
      const multiPlatformRows = [
        ...SNAPSHOT_ROWS,
        { platform: 'xiaohongshu', date: '2026-01-02', day_n: 1, views: 500, likes: 25, comments: 5, shares: 2, saves: 1 },
      ];
      mockQuery.mockResolvedValueOnce({ rows: multiPlatformRows });
      const res = await request(app)
        .get(`/api/works/${WORK_ID}/performance`)
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.platforms).toHaveProperty('douyin');
      expect(res.body.platforms).toHaveProperty('xiaohongshu');
    });

    it('returns 500 on DB error', async () => {
      // reset the tenantContext mock so it fires again with new mockQuery
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }] }); // tenantContext
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app)
        .get(`/api/works/${WORK_ID}/performance`)
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(500);
    });
  });
});
