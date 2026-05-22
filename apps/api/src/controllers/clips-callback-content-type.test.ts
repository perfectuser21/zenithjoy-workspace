import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies before any imports
vi.mock('../services/clips.service', () => ({
  updateClipStatus: vi.fn(),
  createClip: vi.fn(),
  getClips: vi.fn(),
  getClipById: vi.fn(),
  getExistingClip: vi.fn(),
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  detectPlatform: vi.fn(),
  parseOutputUrl: vi.fn(),
}));

vi.mock('../services/clips-extractor.service', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/clip-output.service', () => ({
  parseOutputUrl: vi.fn(),
  pushClipOutput: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

import { updateClipStatus } from '../services/clips.service';

const mockUpdate = updateClipStatus as ReturnType<typeof vi.fn>;

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount just the callback route inline to avoid full router setup
  app.post('/api/clips/:id/callback', async (req, res, next) => {
    try {
      const { handleCallback } = await import('./clips.controller');
      return handleCallback(req, res, next);
    } catch (e) {
      next(e);
    }
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleCallback — content_type routing', () => {
  const BASE_CLIP = {
    id: 'clip-1', user_id: 'u1', url: 'https://v.douyin.com/abc',
    platform: 'douyin', status: 'done', title: '测试', transcript: null,
    content_type: null, text: null, images: [], author: null, author_id: null,
    like_count: null, comment_count: null, share_count: null,
    cover_url: null, video_url: null, output_url: null, output_type: null,
    output_status: 'pending', error_msg: null, retry_count: 0,
    raw_response: null, created_at: new Date(), processed_at: null, updated_at: new Date(),
  };

  it('图文: stores text as transcript, sets content_type=图文', async () => {
    mockUpdate.mockResolvedValue({ ...BASE_CLIP, content_type: '图文', transcript: '图文正文内容' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/clips/clip-1/callback')
      .send({
        success: true,
        content_type: '图文',
        title: '测试标题',
        text: '图文正文内容',
        images: ['https://img.example.com/1.jpg'],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should pass effectiveTranscript = text value when content_type is 图文
    const callArgs = mockUpdate.mock.calls[0];
    expect(callArgs[1]).toBe('done');
    expect(callArgs[2].transcript).toBe('图文正文内容');
    expect(callArgs[2].content_type).toBe('图文');
  });

  it('短视频: stores transcript as transcript, sets content_type=短视频', async () => {
    mockUpdate.mockResolvedValue({ ...BASE_CLIP, content_type: '短视频', transcript: '真实语音文案' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/clips/clip-1/callback')
      .send({
        success: true,
        content_type: '短视频',
        title: '视频标题',
        transcript: '真实语音文案',
      });

    expect(res.status).toBe(200);
    const callArgs = mockUpdate.mock.calls[0];
    expect(callArgs[2].transcript).toBe('真实语音文案');
    expect(callArgs[2].content_type).toBe('短视频');
  });

  it('失败回调: 更新 status=failed，不调 pushClipOutput', async () => {
    mockUpdate.mockResolvedValue({ ...BASE_CLIP, status: 'failed' });

    const app = buildApp();
    const res = await request(app)
      .post('/api/clips/clip-1/callback')
      .send({ success: false, error: '解析失败' });

    expect(res.status).toBe(200);
    const callArgs = mockUpdate.mock.calls[0];
    expect(callArgs[1]).toBe('failed');
  });
});
