import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../src/services/sse.service', () => ({
  sseService: {
    subscribe: vi.fn(),
    emit: vi.fn(),
    close: vi.fn(),
  },
}));

import app from '../src/app';
import pool from '../src/db/connection';

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

describe('SSE 端点', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/acquisition/collect/:task_id/sse', () => {
    it('未知 task_id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/acquisition/collect/nonexistent-id/sse');
      expect(res.status).toBe(404);
    });

    it('已知 task_id 调用 sseService.subscribe', async () => {
      const { sseService } = await import('../src/services/sse.service');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'task-1', status: 'running', video_count: 5, lead_count_raw: 2, created_at: new Date(), ended_at: null }],
      });
      await request(app)
        .get('/api/acquisition/collect/task-1/sse')
        .timeout(500)
        .catch(() => { /* SSE 长连接，超时正常 */ });
      expect(sseService.subscribe).toHaveBeenCalledWith(
        'task-1',
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ status: 'running' })
      );
    });
  });

  describe('GET /api/ai-video/task/:id/sse', () => {
    it('未知 id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/ai-video/task/nonexistent-id/sse');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/ai-video/jobs/:id/sse', () => {
    it('未知 id 返回 404', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get('/api/ai-video/jobs/nonexistent-id/sse');
      expect(res.status).toBe(404);
    });
  });
});
