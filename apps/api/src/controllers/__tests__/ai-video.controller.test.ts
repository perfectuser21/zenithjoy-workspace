/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/ai-video-upload.service', () => ({
  AiVideoUploadService: vi.fn().mockImplementation(() => ({
    createJob: vi.fn().mockResolvedValue('test-job-id'),
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('POST /api/ai-video/upload', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../../app')).default;
  });

  it('no video file → 400 video file is required', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .field('script', 'test script');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('video file is required');
  });

  it('video but no script/title → 400 script or title is required', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .attach('video', Buffer.from('fake-video-data'), 'test.mp4');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('script or title is required');
  });

  it('valid video + script → 201 queued', async () => {
    const res = await request(app)
      .post('/api/ai-video/upload')
      .set('X-Feishu-User-Id', 'ou_test_001')
      .attach('video', Buffer.from('fake-video-data'), 'test.mp4')
      .field('script', 'my test script');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('queued');
    expect(res.body.progress).toBe(0);
    expect(res.body.script_text).toBe('my test script');
    expect(res.body.id).toBeTruthy();
  });
});
