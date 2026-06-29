import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// vi.hoisted 确保 mockMethods 在模块求值前就存在，让 controller 拿到同一批 mock fn
const mockMethods = vi.hoisted(() => ({
  getAllGenerations: vi.fn(),
  getActiveGenerations: vi.fn(),
  getGenerationById: vi.fn(),
  createGeneration: vi.fn(),
  updateGeneration: vi.fn(),
  deleteGeneration: vi.fn(),
}));

vi.mock('../src/services/ai-video.service', () => ({
  AiVideoService: vi.fn().mockImplementation(function() { return mockMethods; }),
}));

import app from '../src/app';

const GENERATION = {
  id: 'gen-uuid-1',
  prompt: 'sunset over mountains',
  model: 'kling-v2-master',
  duration: 5,
  aspect_ratio: '16:9',
  status: 'completed',
  video_url: 'https://cdn.example.com/video.mp4',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const TEST_USER = 'ou_ai_video_test_001';

describe('AI Video API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/ai-video/history', () => {
    it('returns paginated list with data and total', async () => {
      mockMethods.getAllGenerations.mockResolvedValueOnce({ data: [GENERATION], total: 1 });
      const res = await request(app)
        .get('/api/ai-video/history')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty list when no generations', async () => {
      mockMethods.getAllGenerations.mockResolvedValueOnce({ data: [], total: 0 });
      const res = await request(app)
        .get('/api/ai-video/history')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });

    it('passes status filter to service', async () => {
      mockMethods.getAllGenerations.mockResolvedValueOnce({ data: [], total: 0 });
      await request(app)
        .get('/api/ai-video/history?status=completed')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(mockMethods.getAllGenerations).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  describe('GET /api/ai-video/active', () => {
    it('returns array of active generations', async () => {
      mockMethods.getActiveGenerations.mockResolvedValueOnce([GENERATION]);
      const res = await request(app)
        .get('/api/ai-video/active')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns empty array when nothing active', async () => {
      mockMethods.getActiveGenerations.mockResolvedValueOnce([]);
      const res = await request(app)
        .get('/api/ai-video/active')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/ai-video/task/:id', () => {
    it('returns generation when found', async () => {
      mockMethods.getGenerationById.mockResolvedValueOnce(GENERATION);
      const res = await request(app)
        .get('/api/ai-video/task/gen-uuid-1')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('gen-uuid-1');
    });

    it('returns 404 when generation not found', async () => {
      mockMethods.getGenerationById.mockResolvedValueOnce(null);
      const res = await request(app)
        .get('/api/ai-video/task/nonexistent')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/ai-video/generate', () => {
    it('creates generation and returns 201', async () => {
      mockMethods.createGeneration.mockResolvedValueOnce(GENERATION);
      const res = await request(app)
        .post('/api/ai-video/generate')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ prompt: 'sunset', model: 'kling-v2-master', duration: 5, aspect_ratio: '16:9' });
      expect(res.status).toBe(201);
    });
  });

  describe('PUT /api/ai-video/task/:id', () => {
    it('updates generation and returns updated body', async () => {
      const updated = { ...GENERATION, status: 'failed' };
      mockMethods.updateGeneration.mockResolvedValueOnce(updated);
      const res = await request(app)
        .put('/api/ai-video/task/gen-uuid-1')
        .set('X-Feishu-User-Id', TEST_USER)
        .send({ status: 'failed' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('failed');
    });
  });

  describe('DELETE /api/ai-video/task/:id', () => {
    it('returns 204 on successful delete', async () => {
      mockMethods.deleteGeneration.mockResolvedValueOnce(undefined);
      const res = await request(app)
        .delete('/api/ai-video/task/gen-uuid-1')
        .set('X-Feishu-User-Id', TEST_USER);
      expect(res.status).toBe(204);
    });
  });
});
