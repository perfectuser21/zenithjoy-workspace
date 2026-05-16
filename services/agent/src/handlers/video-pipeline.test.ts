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

  it('throws when src_video is null', async () => {
    await expect(
      handler.processVideoPipelineJob('http://localhost', { id: 'x', src_video: null, topic: null, status: 'pending' })
    ).rejects.toThrow('src_video not found on local disk');
  });

  it('throws when src_video path does not exist on disk', async () => {
    // ESM 中 fs 不可 spy，用真实不存在的路径触发 existsSync 返回 false
    await expect(
      handler.processVideoPipelineJob('http://localhost', { id: 'y', src_video: '/tmp/zj-nonexistent-video-path-xyz.mp4', topic: null, status: 'pending' })
    ).rejects.toThrow('src_video not found on local disk');
  });
});
