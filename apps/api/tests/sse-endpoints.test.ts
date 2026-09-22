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

  // 0922: /api/acquisition/collect/:task_id/sse 随系统①(routes/acquisition.ts)退役一并移除,
  // 该路由已不存在。

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
