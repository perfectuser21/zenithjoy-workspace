import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('./clip-output.service', () => ({
  parseOutputUrl: vi.fn(),
}));

import pool from '../db/connection';
import {
  detectPlatform,
  createClip,
  getClips,
  getClipById,
  updateClipStatus,
  getExistingClip,
  getSettings,
  upsertSettings,
} from './clips.service';

const mockPool = pool as { query: ReturnType<typeof vi.fn> };

const FAKE_CLIP = {
  id: 'uuid-1',
  user_id: 'user-1',
  url: 'https://v.douyin.com/abc',
  platform: 'douyin',
  status: 'pending',
  title: null,
  transcript: null,
  images: [],
  author: null,
  author_id: null,
  like_count: null,
  comment_count: null,
  share_count: null,
  cover_url: null,
  video_url: null,
  output_url: null,
  output_type: null,
  output_status: 'pending',
  error_msg: null,
  retry_count: 0,
  raw_response: null,
  created_at: new Date(),
  processed_at: null,
  updated_at: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectPlatform', () => {
  it('detects douyin.com', () => {
    expect(detectPlatform('https://www.douyin.com/video/123')).toBe('douyin');
  });
  it('detects v.douyin.com short link', () => {
    expect(detectPlatform('https://v.douyin.com/abc123/')).toBe('douyin');
  });
  it('detects xiaohongshu.com', () => {
    expect(detectPlatform('https://www.xiaohongshu.com/explore/xxx')).toBe('xiaohongshu');
  });
  it('detects xhslink.com short link', () => {
    expect(detectPlatform('http://xhslink.com/o/abc')).toBe('xiaohongshu');
  });
  it('returns null for unknown', () => {
    expect(detectPlatform('https://youtube.com/watch')).toBeNull();
  });
});

describe('createClip', () => {
  it('inserts a new clip and returns it', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [FAKE_CLIP] });
    const result = await createClip({
      userId: 'user-1',
      url: 'https://v.douyin.com/abc',
      platform: 'douyin',
    });
    expect(result.id).toBe('uuid-1');
    expect(mockPool.query).toHaveBeenCalledOnce();
  });
});

describe('getClips', () => {
  it('returns data and total', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [FAKE_CLIP] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const result = await getClips('user-1', { limit: 20, offset: 0 });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('applies platform filter', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const result = await getClips('user-1', { platform: 'douyin', limit: 20, offset: 0 });
    expect(result.total).toBe(0);
  });
});

describe('getClipById', () => {
  it('returns clip if found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [FAKE_CLIP] });
    const result = await getClipById('uuid-1', 'user-1');
    expect(result?.id).toBe('uuid-1');
  });

  it('returns null if not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getClipById('uuid-1', 'user-1');
    expect(result).toBeNull();
  });
});

describe('updateClipStatus', () => {
  it('updates status to done with extra fields', async () => {
    const updated = { ...FAKE_CLIP, status: 'done', title: 'Test Title' };
    mockPool.query.mockResolvedValueOnce({ rows: [updated] });
    const result = await updateClipStatus('uuid-1', 'done', { title: 'Test Title' });
    expect(result.status).toBe('done');
  });

  it('updates status to failed with error_msg', async () => {
    const updated = { ...FAKE_CLIP, status: 'failed', error_msg: 'timeout' };
    mockPool.query.mockResolvedValueOnce({ rows: [updated] });
    const result = await updateClipStatus('uuid-1', 'failed', { error_msg: 'timeout' });
    expect(result.status).toBe('failed');
  });
});

describe('getExistingClip', () => {
  it('returns existing clip by user+url', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [FAKE_CLIP] });
    const result = await getExistingClip('user-1', 'https://v.douyin.com/abc');
    expect(result?.id).toBe('uuid-1');
  });

  it('returns null when no match', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getExistingClip('user-1', 'https://v.douyin.com/xyz');
    expect(result).toBeNull();
  });
});

describe('getSettings / upsertSettings', () => {
  it('returns null when no settings row', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getSettings('user-1');
    expect(result).toBeNull();
  });

  it('returns settings when row exists', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ default_output_url: 'https://notion.so/db', default_output_type: 'notion' }],
    });
    const result = await getSettings('user-1');
    expect(result?.defaultOutputType).toBe('notion');
  });

  it('upserts settings without throwing', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      upsertSettings('user-1', { defaultOutputUrl: 'https://notion.so/db', defaultOutputType: 'notion' })
    ).resolves.toBeUndefined();
  });
});
