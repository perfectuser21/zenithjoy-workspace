import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../src/app';
import pool from '../src/db/connection';
import { detectPlatform } from '../src/services/clips.service';

vi.mock('../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

vi.mock('../src/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('../src/services/clips-extractor.service', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
  ocrImages: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/services/clip-output.service', () => ({
  pushClipOutput: vi.fn().mockResolvedValue({ success: true }),
  parseOutputUrl: vi.fn().mockReturnValue(null),
}));

import { auth } from '../src/auth';
const mockGetSession = auth.api.getSession as ReturnType<typeof vi.fn>;
const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TEST_USER = 'user-001';
const MOCK_SESSION = { user: { id: TEST_USER } };

const CLIP_FIXTURE = {
  id: 'clip-uuid-1',
  user_id: TEST_USER,
  url: 'https://www.douyin.com/video/123456',
  platform: 'douyin',
  status: 'pending',
  title: null,
  content_type: null,
  transcript: null,
  ocr_text: null,
  images: [],
  author: null,
  like_count: null,
  cover_url: null,
  video_url: null,
  output_url: null,
  output_type: null,
  output_status: 'pending',
  error_msg: null,
  retry_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  processed_at: null,
};

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('detectPlatform — Unit Tests', () => {
  it('抖音 www.douyin.com 链接', () => {
    expect(detectPlatform('https://www.douyin.com/video/123456')).toBe('douyin');
  });

  it('抖音短链 v.douyin.com', () => {
    expect(detectPlatform('https://v.douyin.com/ABC123/')).toBe('douyin');
  });

  it('小红书 www.xiaohongshu.com 链接', () => {
    expect(detectPlatform('https://www.xiaohongshu.com/discovery/item/abc')).toBe('xiaohongshu');
  });

  it('小红书短链 xhslink.com', () => {
    expect(detectPlatform('https://xhslink.com/a/UP5Rg84J')).toBe('xiaohongshu');
  });

  it('不支持的平台返回 null', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBeNull();
  });
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Clips API — Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(MOCK_SESSION);
  });

  // POST /api/clips

  it('POST /api/clips — 新链接创建成功，返回 201', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })           // getSettings → 无默认输出
      .mockResolvedValueOnce({ rows: [] })            // getExistingClip → 不存在
      .mockResolvedValueOnce({ rows: [CLIP_FIXTURE] }); // createClip

    const res = await request(app)
      .post('/api/clips')
      .send({ url: 'https://www.douyin.com/video/123456' });

    expect(res.status).toBe(201);
    expect(res.body.platform).toBe('douyin');
    expect(res.body.status).toBe('pending');
  });

  it('POST /api/clips — 重复链接重新采集，返回 200', async () => {
    const existingClip = { ...CLIP_FIXTURE, status: 'done' };
    const resetClip = { ...CLIP_FIXTURE, status: 'pending' };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })               // getSettings
      .mockResolvedValueOnce({ rows: [existingClip] })   // getExistingClip → 已存在
      .mockResolvedValueOnce({ rows: [resetClip] });     // updateClipStatus → reset to pending

    const res = await request(app)
      .post('/api/clips')
      .send({ url: 'https://www.douyin.com/video/123456' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });

  it('POST /api/clips — 缺少 url 返回 400', async () => {
    const res = await request(app).post('/api/clips').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('url_required');
  });

  it('POST /api/clips — 不支持的平台返回 400', async () => {
    const res = await request(app)
      .post('/api/clips')
      .send({ url: 'https://www.youtube.com/watch?v=abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_platform');
  });

  it('POST /api/clips — 未登录返回 401', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/clips')
      .send({ url: 'https://www.douyin.com/video/123456' });
    expect(res.status).toBe(401);
  });

  // POST /api/clips/:id/callback

  it('callback — 图文成功写入 ocr_text', async () => {
    const doneClip = { ...CLIP_FIXTURE, status: 'done', content_type: '图文', ocr_text: '提取的文字' };
    mockQuery.mockResolvedValue({ rows: [doneClip] });

    const res = await request(app)
      .post('/api/clips/clip-uuid-1/callback')
      .send({
        success: true,
        content_type: '图文',
        title: '测试帖子',
        images: ['https://example.com/img1.jpg'],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('callback — 首页标题触发 failed（短链跳到平台首页）', async () => {
    const failedClip = { ...CLIP_FIXTURE, status: 'failed' };
    mockQuery.mockResolvedValue({ rows: [failedClip] });

    const res = await request(app)
      .post('/api/clips/clip-uuid-1/callback')
      .send({
        success: true,
        content_type: '图文',
        title: '小红书 - 你的生活兴趣社区',
        images: [],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('callback — success=false 触发 failed', async () => {
    const failedClip = { ...CLIP_FIXTURE, status: 'failed' };
    mockQuery.mockResolvedValue({ rows: [failedClip] });

    const res = await request(app)
      .post('/api/clips/clip-uuid-1/callback')
      .send({ success: false, error: '链接无效' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // GET /api/clips

  it('GET /api/clips — 返回列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [CLIP_FIXTURE], rowCount: 1 })
             .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/clips');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
