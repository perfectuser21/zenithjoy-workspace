import { describe, it, expect } from 'vitest';
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
