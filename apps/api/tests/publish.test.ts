import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TEST_WORK_ID = '11111111-1111-1111-1111-111111111111';
const TEST_LOG_ID = 'log-uuid-1';

const LOG = {
  id: TEST_LOG_ID,
  work_id: TEST_WORK_ID,
  platform: 'douyin',
  status: 'pending',
  platform_post_id: null,
  scheduled_at: null,
  response: null,
  error_message: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('Publish Logs API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/works/:workId/publish-logs', () => {
    it('should create a new publish log', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [LOG] });

      const response = await request(app)
        .post(`/api/works/${TEST_WORK_ID}/publish-logs`)
        .send({ work_id: TEST_WORK_ID, platform: 'douyin', status: 'pending' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.work_id).toBe(TEST_WORK_ID);
      expect(response.body.platform).toBe('douyin');
      expect(response.body.status).toBe('pending');
    });

    it('should return 400 for missing work_id', async () => {
      const response = await request(app)
        .post(`/api/works/${TEST_WORK_ID}/publish-logs`)
        .send({ platform: 'xiaohongshu' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid platform', async () => {
      const response = await request(app)
        .post(`/api/works/${TEST_WORK_ID}/publish-logs`)
        .send({ work_id: TEST_WORK_ID, platform: 'invalid_platform' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate (work_id, platform)', async () => {
      mockQuery.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' })
      );

      const response = await request(app)
        .post(`/api/works/${TEST_WORK_ID}/publish-logs`)
        .send({ work_id: TEST_WORK_ID, platform: 'douyin' });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /api/works/:workId/publish-logs', () => {
    it('should get publish logs for a work', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [LOG] });

      const response = await request(app).get(`/api/works/${TEST_WORK_ID}/publish-logs`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].work_id).toBe(TEST_WORK_ID);
    });

    it('should return empty array for work with no logs', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app).get(`/api/works/${fakeId}/publish-logs`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('PUT /api/publish-logs/:id', () => {
    it('should update a publish log', async () => {
      const publishedAt = new Date().toISOString();
      const updatedLog = { ...LOG, status: 'published', platform_post_id: '123456', published_at: publishedAt };
      mockQuery
        .mockResolvedValueOnce({ rows: [LOG] })           // SELECT check
        .mockResolvedValueOnce({ rows: [updatedLog] });   // UPDATE

      const response = await request(app)
        .put(`/api/publish-logs/${TEST_LOG_ID}`)
        .send({ status: 'published', platform_post_id: '123456', published_at: publishedAt });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('published');
      expect(response.body.platform_post_id).toBe('123456');
      expect(response.body).toHaveProperty('published_at');
    });

    it('should return 404 for non-existent log', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT check returns empty

      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .put(`/api/publish-logs/${fakeId}`)
        .send({ status: 'published' });

      expect(response.status).toBe(404);
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .put(`/api/publish-logs/${TEST_LOG_ID}`)
        .send({ status: 'invalid_status' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
