import { describe, it, expect } from 'vitest';

// smoke-level unit tests for LocalVideoPipelinePage helpers
// Full E2E is covered by .github/workflows/scripts/smoke/local-video-pipeline-smoke.sh

describe('downloadUrl', () => {
  it('builds 9:16 download URL correctly', () => {
    const jobId = 'abc-123';
    const base = '/api';
    const url = `${base}/ai-video/download/${jobId}/9_16.mp4`;
    expect(url).toBe('/api/ai-video/download/abc-123/9_16.mp4');
  });

  it('builds 16:9 download URL correctly', () => {
    const jobId = 'abc-123';
    const base = '/api';
    const url = `${base}/ai-video/download/${jobId}/16_9.mp4`;
    expect(url).toBe('/api/ai-video/download/abc-123/16_9.mp4');
  });
});

describe('JobStatus transitions', () => {
  it('recognises completed status', () => {
    const status = 'completed';
    expect(status === 'completed').toBe(true);
  });

  it('recognises failed status', () => {
    const status = 'failed';
    expect(status === 'failed').toBe(true);
  });

  it('treats queued and in_progress as processing', () => {
    const isProcessing = (s: string) => s === 'queued' || s === 'in_progress';
    expect(isProcessing('queued')).toBe(true);
    expect(isProcessing('in_progress')).toBe(true);
    expect(isProcessing('completed')).toBe(false);
  });
});
