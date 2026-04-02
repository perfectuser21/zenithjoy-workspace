import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('Snapshots API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/snapshots/ingest', () => {
    it('should return 400 when platform is missing', async () => {
      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({ items: [{ content_id: 'abc', scraped_date: '2026-04-02' }] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when items is empty', async () => {
      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({ platform: 'douyin', items: [] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 400 for invalid platform', async () => {
      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({ platform: 'invalid_platform', items: [{ content_id: 'abc', scraped_date: '2026-04-02' }] });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should insert items and return success', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] });

      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'douyin',
          items: [
            { content_id: 'test001', scraped_date: '2026-04-02', title: 'Test', views: 100, likes: 10 },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.platform).toBe('douyin');
      expect(response.body.inserted).toBe(1);
    });

    it('should skip items missing content_id or scraped_date', async () => {
      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'weibo',
          items: [
            { title: 'No ID', views: 100 },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.inserted).toBe(0);
    });

    it('should return 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app)
        .post('/api/snapshots/ingest')
        .send({
          platform: 'douyin',
          items: [{ content_id: 'test001', scraped_date: '2026-04-02' }],
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/snapshots/:platform', () => {
    it('should return platform data', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 1, platform: 'douyin', content_id: 'abc', scraped_date: '2026-04-02', views: 100 }],
      });

      const response = await request(app).get('/api/snapshots/douyin');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.platform).toBe('douyin');
      expect(response.body.data).toHaveLength(1);
    });

    it('should support date filter', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const response = await request(app).get('/api/snapshots/weibo?date=2026-04-02');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/snapshots/douyin');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/snapshots/work/:workId', () => {
    it('should return work data across platforms', async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { platform: 'douyin', content_id: 'abc', scraped_date: '2026-04-02', day_n: 1 },
          { platform: 'weibo', content_id: 'xyz', scraped_date: '2026-04-02', day_n: 1 },
        ],
      });

      const response = await request(app).get('/api/snapshots/work/work-uuid-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.work_id).toBe('work-uuid-123');
      expect(response.body.data).toHaveLength(2);
    });

    it('should return 500 on database error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const response = await request(app).get('/api/snapshots/work/some-work-id');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });
});
