/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/ai-video-upload.service', () => ({
  AiVideoUploadService: vi.fn().mockImplementation(function() {
    return { createJob: vi.fn().mockResolvedValue('test-job'), dispatch: vi.fn().mockResolvedValue(undefined) };
  }),
}));

describe('POST /api/ai-video/upload route', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('non-multipart request → 400 (no video file)', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('Content-Type', 'application/json')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .send({ script: 'test' });

    expect(res.status).toBe(400);
  });
});
