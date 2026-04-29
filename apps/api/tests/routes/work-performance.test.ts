import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TEST_USER = 'ou_test_user_001';
const TEST_TENANT_ID = 'tttttttt-1111-2222-3333-444444444444';

describe('Work Performance API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/works/:id/performance', () => {
    beforeEach(() => {
      // tenantContext 中间件查询 tenant_members → tenant_id
      mockQuery.mockResolvedValueOnce({
        rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }],
      });
    });

    it('returns platforms grouped by platform key', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 3,
        rows: [
          { platform: 'douyin',      date: '2026-04-20', day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100 },
          { platform: 'douyin',      date: '2026-04-21', day_n: 2, views: 8000, likes: 420, comments: 80, shares: 35, saves: 150 },
          { platform: 'xiaohongshu', date: '2026-04-20', day_n: 1, views: 2000, likes: 150, comments: 30, shares: 10, saves: 500 },
        ],
      });

      const res = await request(app)
        .get('/api/works/work-uuid-001/performance')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platforms).toHaveProperty('douyin');
      expect(res.body.platforms).toHaveProperty('xiaohongshu');
      expect(res.body.platforms.douyin).toHaveLength(2);
      expect(res.body.platforms.douyin[0]).toMatchObject({
        day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100,
      });
      expect(res.body.platforms.xiaohongshu).toHaveLength(1);
    });

    it('returns empty platforms object when work has no snapshots', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app)
        .get('/api/works/work-uuid-empty/performance')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-empty');
      expect(res.body.platforms).toEqual({});
    });

    it('returns 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/works/work-uuid-001/performance')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/works/:id/performance/:platform', () => {
    beforeEach(() => {
      // tenantContext 中间件查询 tenant_members → tenant_id
      mockQuery.mockResolvedValueOnce({
        rows: [{ tenant_id: TEST_TENANT_ID, role: 'member' }],
      });
    });

    it('returns single platform data with published_at', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { published_at: '2026-04-19T10:00:00Z', date: '2026-04-20', day_n: 1, views: 5000, likes: 300, comments: 50, shares: 20, saves: 100 },
          { published_at: '2026-04-19T10:00:00Z', date: '2026-04-21', day_n: 2, views: 8000, likes: 420, comments: 80, shares: 35, saves: 150 },
        ],
      });

      const res = await request(app)
        .get('/api/works/work-uuid-001/performance/douyin')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platform).toBe('douyin');
      expect(res.body.published_at).toBe('2026-04-19T10:00:00Z');
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({ day_n: 1, views: 5000, saves: 100 });
    });

    it('returns empty data array when platform has no snapshots', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await request(app)
        .get('/api/works/work-uuid-001/performance/kuaishou')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(200);
      expect(res.body.work_id).toBe('work-uuid-001');
      expect(res.body.platform).toBe('kuaishou');
      expect(res.body.published_at).toBeNull();
      expect(res.body.data).toEqual([]);
    });

    it('returns 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await request(app)
        .get('/api/works/work-uuid-001/performance/weibo')
        .set('X-Feishu-User-Id', TEST_USER);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/snapshots/ingest saves field', () => {
    it('extracts saves from top-level item.saves', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

      const res = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'xiaohongshu',
          items: [{ content_id: 'note001', scraped_date: '2026-04-20', views: 2000, likes: 150, saves: 500 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);

      const insertCall = mockQuery.mock.calls[0];
      const sql: string = insertCall[0];
      const params: unknown[] = insertCall[1];
      expect(sql).toContain('saves');
      expect(params).toContain(500);
    });

    it('falls back to extra_data.favorites when saves not present', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: '1' }] });

      const res = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'kuaishou',
          items: [{ content_id: 'photo001', scraped_date: '2026-04-20', views: 3000, extra_data: { favorites: 200 } }],
        });

      expect(res.status).toBe(200);

      const insertCall = mockQuery.mock.calls[0];
      const params: unknown[] = insertCall[1];
      expect(params).toContain(200);
    });
  });
});
