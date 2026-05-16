import { describe, it, expect } from 'vitest';
import * as controller from '../../src/controllers/ai-video-pipeline.controller';

describe('ai-video-pipeline.controller exports', () => {
  it('exports createJob handler', () => {
    expect(typeof controller.createJob).toBe('function');
  });
  it('exports getJob handler', () => {
    expect(typeof controller.getJob).toBe('function');
  });
  it('exports listJobs handler', () => {
    expect(typeof controller.listJobs).toBe('function');
  });
  it('exports updateProgress handler', () => {
    expect(typeof controller.updateProgress).toBe('function');
  });
  it('exports completeJob handler', () => {
    expect(typeof controller.completeJob).toBe('function');
  });
  it('does NOT export downloadSource', () => {
    expect((controller as Record<string, unknown>).downloadSource).toBeUndefined();
  });
  it('does NOT export uploadOutput', () => {
    expect((controller as Record<string, unknown>).uploadOutput).toBeUndefined();
  });
  it('does NOT export downloadOutput', () => {
    expect((controller as Record<string, unknown>).downloadOutput).toBeUndefined();
  });
});
