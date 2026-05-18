import { describe, it, expect, vi, afterEach } from 'vitest';
import * as handler from './video-pipeline';

describe('video-pipeline handler exports', () => {
  it('exports processVideoPipelineJob', () => {
    expect(typeof handler.processVideoPipelineJob).toBe('function');
  });

  it('exports startVideoPipelineLoop', () => {
    expect(typeof handler.startVideoPipelineLoop).toBe('function');
  });

  it('VideoPipelineJob interface has src_video field (not a download URL)', () => {
    const job: handler.VideoPipelineJob = {
      id: 'test-id',
      src_video: 'C:\\Users\\xuxia\\Videos\\test.mp4',
      topic: null,
      status: 'pending',
    };
    expect(job.src_video).toContain('test.mp4');
  });
});

describe('processVideoPipelineJob — src_video validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('src_video 为 null 时，调用 reportComplete 并返回（不 throw）', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(
      handler.processVideoPipelineJob('http://localhost', { id: 'x', src_video: null, topic: null, status: 'pending' })
    ).resolves.toBeUndefined();
    // reportComplete 应被调用（PUT complete 端点）
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/complete'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('src_video 路径不存在时，调用 reportComplete 并返回（不 throw）', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);
    await expect(
      handler.processVideoPipelineJob('http://localhost', { id: 'y', src_video: '/tmp/zj-nonexistent-video-path-xyz.mp4', topic: null, status: 'pending' })
    ).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/complete'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
